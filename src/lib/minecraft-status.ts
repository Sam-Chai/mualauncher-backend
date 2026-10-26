import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";

export class MinecraftProbeError extends Error {
  constructor(public reason: "TIMEOUT" | "UNREACHABLE" | "NOT_MINECRAFT", message: string) { super(message); }
}
export function encodeVarInt(value: number) {
  const bytes: number[] = []; let remaining = value >>> 0;
  do { let byte = remaining & 0x7f; remaining >>>= 7; if (remaining) byte |= 0x80; bytes.push(byte); } while (remaining);
  return Buffer.from(bytes);
}
export function decodeVarInt(buffer: Buffer, offset = 0): { value: number; bytes: number } | null {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index];
    if (index === 4 && (byte & 0xf0)) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.serverReturnedInvalidMinecraftData"));
    value |= (byte & 0x7f) << (index * 7);
    if (!(byte & 0x80)) return { value: value >>> 0, bytes: index + 1 };
  }
  throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.serverReturnedInvalidMinecraftData"));
}
export const statusPacket = (payload: Buffer) => Buffer.concat([encodeVarInt(payload.length), payload]);
const responseSchema = z.object({
  version: z.object({ name: z.string().max(1024), protocol: z.number().int() }),
  description: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  players: z.object({ online: z.number().int().min(0), max: z.number().int().min(0) }).nullish(),
});
export type MinecraftStatus = { latencyMs: number; latencyKind: "PONG" | "STATUS"; version: string; playersOnline: number | null };

// The destination is a previously validated, pinned IP; hostname is used only by the Minecraft handshake.
export function minecraftStatus(target: { address: string; family: number; port: number; hostname: string }, timeoutMs = 5000): Promise<MinecraftStatus> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.address, family: target.family, port: target.port });
    let buffer = Buffer.alloc(0), finished = false, statusStarted = 0, pingStarted = 0;
    let info: MinecraftStatus | null = null, pongTimer: ReturnType<typeof setTimeout> | undefined;
    const token = randomBytes(8);
    const finish = (error?: Error, result?: MinecraftStatus) => {
      if (finished) return; finished = true; clearTimeout(timeout); clearTimeout(pongTimer); socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const fallback = () => finish(undefined, info!);
    const timeout = setTimeout(() => info ? fallback() : finish(new MinecraftProbeError("TIMEOUT", diagnosticText("diagnostics.minecraftStatus.connectionOrMinecraftStatusRequestTimedOut"))), timeoutMs);
    socket.once("connect", () => {
      const hostname = Buffer.from(target.hostname, "utf8"), port = Buffer.alloc(2); port.writeUInt16BE(target.port);
      const handshake = statusPacket(Buffer.concat([encodeVarInt(0), encodeVarInt(-1), encodeVarInt(hostname.length), hostname, port, encodeVarInt(1)]));
      statusStarted = performance.now(); socket.write(Buffer.concat([handshake, statusPacket(Buffer.from([0]))]));
    });
    socket.on("data", chunk => {
      if (finished) return;
      try {
        if (buffer.length + chunk.length > 1024 * 1024) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.serverStatusResponseTooLarge"));
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length) {
          const length = decodeVarInt(buffer); if (!length) break;
          if (length.value < 1 || length.value > 1024 * 1024) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.noValidMinecraftStatusDataReturned"));
          if (buffer.length < length.bytes + length.value) break;
          const packet = buffer.subarray(length.bytes, length.bytes + length.value); buffer = buffer.subarray(length.bytes + length.value);
          const id = decodeVarInt(packet);
          if (!id) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.noValidMinecraftStatusDataReturned"));
          if (!info) {
            const size = decodeVarInt(packet, id.bytes);
            if (id.value !== 0 || !size || id.bytes + size.bytes + size.value !== packet.length) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.connectedButNoValidMinecraftStatusReturned"));
            let value: unknown;
            try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packet.subarray(id.bytes + size.bytes))); }
            catch { throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.connectedButNoValidMinecraftStatusReturned")); }
            const parsed = responseSchema.safeParse(value);
            if (!parsed.success) throw new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.connectedButResponseIsNotAValidMinecraftStatus"));
            info = { version: parsed.data.version.name.replace(/§[0-9a-fk-or]/gi, "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 100),
              playersOnline: parsed.data.players?.online ?? null, latencyMs: Math.max(0, Math.round(performance.now() - statusStarted)), latencyKind: "STATUS" };
            pingStarted = performance.now(); socket.write(statusPacket(Buffer.concat([Buffer.from([1]), token])));
            pongTimer = setTimeout(fallback, Math.min(1000, timeoutMs));
          } else {
            if (id.value === 1 && packet.length === id.bytes + 8 && packet.subarray(id.bytes).equals(token))
              finish(undefined, { ...info, latencyMs: Math.max(0, Math.round(performance.now() - pingStarted)), latencyKind: "PONG" });
            else fallback();
          }
        }
      } catch (error) { if (info) fallback(); else finish(error instanceof Error ? error : new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.invalidMinecraftStatusResponse"))); }
    });
    socket.once("error", () => info ? fallback() : finish(new MinecraftProbeError("UNREACHABLE", diagnosticText("diagnostics.minecraftStatus.connectionFailedServerStoppedConnectionRefusedOrNetworkUnreachable"))));
    socket.once("end", () => info ? fallback() : finish(new MinecraftProbeError("NOT_MINECRAFT", diagnosticText("diagnostics.minecraftStatus.connectionClosedWithoutValidMinecraftStatusStatusQueriesMayBe"))));
    socket.once("close", () => { if (finished) return; if (info) fallback(); else finish(new MinecraftProbeError("UNREACHABLE", diagnosticText("diagnostics.minecraftStatus.disconnectedWithoutMinecraftStatus"))); });
  });
}
