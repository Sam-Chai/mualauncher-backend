import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Socket } from "node:net";
import { minecraftStatus, encodeVarInt, decodeVarInt, statusPacket, MinecraftProbeError } from "../src/lib/minecraft-status";
import { createProbeCache, parseMinecraftAddress, resolveMinecraftTarget, probeMinecraftAddress, onlineProbe } from "../src/lib/server-probe";

async function fakeServer(handler: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); handler(socket); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  return { target: { address: "127.0.0.1", family: 4, port: address.port, hostname: "game.example.test" },
    close: () => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }) };
}
const statusJson = { version: { name: "1.21.1", protocol: 767 }, description: { text: "Test MC" }, players: { online: 2, max: 20 } };
function reply(socket: Socket, options: { delay?: number; noPong?: boolean; badPong?: boolean; invalid?: boolean; fragmented?: boolean; hiddenPlayers?: boolean; statusDelay?: number } = {}) {
  let buffer = Buffer.alloc(0), packets = 0;
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      const frame = decodeVarInt(buffer); if (!frame || buffer.length < frame.bytes + frame.value) break;
      const payload = buffer.subarray(frame.bytes, frame.bytes + frame.value); buffer = buffer.subarray(frame.bytes + frame.value);
      packets++;
      if (packets === 2) {
        assert.deepEqual(payload, Buffer.from([0]));
        const json = Buffer.from(JSON.stringify(options.invalid ? { online: true } : options.hiddenPlayers ? { ...statusJson, players: null } : statusJson));
        const packet = statusPacket(Buffer.concat([Buffer.from([0]), encodeVarInt(json.length), json]));
        if (options.fragmented) { socket.write(packet.subarray(0, 1)); setImmediate(() => socket.write(packet.subarray(1, 8))); setTimeout(() => socket.write(packet.subarray(8)), 10); }
        else if (options.statusDelay) setTimeout(() => { if (!socket.destroyed) socket.write(packet); }, options.statusDelay);
        else socket.write(packet);
      }
      if (packets === 3 && !options.noPong) setTimeout(() => {
        if (!socket.destroyed) socket.write(statusPacket(options.badPong ? Buffer.concat([Buffer.from([1]), Buffer.alloc(8)]) : payload));
      }, options.delay ?? 0);
    }
  });
}

test("Minecraft handshake and matching pong verify protocol and measure actual round-trip latency across fragmented packets", async () => {
  const server = await fakeServer(socket => reply(socket, { fragmented: true, delay: 65 }));
  try {
    const result = await minecraftStatus(server.target, 1000);
    assert.equal(result.version, "1.21.1"); assert.equal(result.playersOnline, 2); assert.equal(result.latencyKind, "PONG");
    assert(result.latencyMs >= 45);
    assert.equal(onlineProbe("example.test", result, 40).state, "HIGH_LATENCY");
  } finally { await server.close(); }
});

test("an open TCP port or arbitrary JSON is never enough to produce a green light", async () => {
  for (const handler of [(socket: Socket) => reply(socket, { invalid: true }), (socket: Socket) => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")]) {
    const server = await fakeServer(handler);
    try { await assert.rejects(minecraftStatus(server.target, 300), error => error instanceof MinecraftProbeError && error.reason === "NOT_MINECRAFT"); }
    finally { await server.close(); }
  }
});

test("a valid Minecraft status remains online when Pong is unsupported, using separately labeled status RTT", async () => {
  for (const options of [{ noPong: true }, { badPong: true }, { noPong: true, hiddenPlayers: true }]) {
    const server = await fakeServer(socket => reply(socket, options));
    try { const result = await minecraftStatus(server.target, 150); assert.equal(result.latencyKind, "STATUS"); assert.equal(result.version, "1.21.1"); if (options.hiddenPlayers) assert.equal(result.playersOnline, null); }
    finally { await server.close(); }
  }
});

test("unresponsive and refused sockets fail with explicit connection reasons", async () => {
  const server = await fakeServer(() => {}), target = server.target;
  try { await assert.rejects(minecraftStatus(target, 40), error => error instanceof MinecraftProbeError && error.reason === "TIMEOUT"); }
  finally { await server.close(); }
  await assert.rejects(minecraftStatus(target, 300), error => error instanceof MinecraftProbeError && error.reason === "UNREACHABLE");
});

test("the overall deadline preserves a verified Minecraft status when the server does not answer Pong", async () => {
  const server = await fakeServer(socket => reply(socket, { noPong: true, statusDelay: 10 }));
  try {
    const result = await probeMinecraftAddress("game.example.test", { timeoutMs: 120, resolve: async () => ({ hostname: server.target.hostname, port: server.target.port, addresses: [{ address: "127.0.0.1", family: 4 }] }) });
    assert.equal(result.state, "ONLINE"); assert.equal(result.latencyKind, "STATUS"); assert.equal(result.version, "1.21.1");
  } finally { await server.close(); }
});

test("address parsing supports ports and IPv6, resolves SRV and pins only public DNS answers", async () => {
  assert.deepEqual(parseMinecraftAddress("mc.example.test"), { hostname: "mc.example.test", port: 25565, explicitPort: false });
  assert.equal(parseMinecraftAddress("mc.example.test:25566").port, 25566);
  assert.equal(parseMinecraftAddress("[2606:4700::1111]:25566").hostname, "2606:4700::1111");
  for (const value of ["https://example.test", "user@example.test", "game.test:0", "game.test:65536", "game.test/path", "bad host", "[bad]:25565"]) assert.throws(() => parseMinecraftAddress(value));
  await assert.rejects(resolveMinecraftTarget("127.0.0.1:25565"), /公网地址/);
  await assert.rejects(resolveMinecraftTarget("[::1]"), /公网地址/);
  let srvCalls = 0; const names: string[] = [];
  const dns = { srv: async () => { srvCalls++; return [{ priority: 0, weight: 1, name: "edge.example.test.", port: 25566 }]; }, addresses: async (name: string) => { names.push(name); return [{ address: "8.8.8.8", family: 4 }]; } };
  const target = await resolveMinecraftTarget("game.example.test", dns);
  assert.equal(target.port, 25566); assert.equal(target.hostname, "game.example.test"); assert.deepEqual(names, ["edge.example.test"]);
  await resolveMinecraftTarget("game.example.test:25565", dns); assert.equal(srvCalls, 1);
  await assert.rejects(resolveMinecraftTarget("game.example.test:25565", { addresses: async () => [{ address: "127.0.0.1", family: 4 }] }), /内网或保留/);
});

test("probes use the pinned destination, apply the exact yellow threshold, and stop after a DNS deadline", async () => {
  const target = { hostname: "game.example.test", port: 25565, addresses: [{ address: "8.8.8.8", family: 4 }] };
  const status = { version: "1.21.1", playersOnline: 2, latencyKind: "PONG" as const, latencyMs: 299 };
  assert.equal(onlineProbe("game.example.test", status, 300).state, "ONLINE");
  assert.equal(onlineProbe("game.example.test", { ...status, latencyMs: 300 }, 300).state, "HIGH_LATENCY");
  const result = await probeMinecraftAddress("game.example.test", { resolve: async () => target, status: async value => { assert.equal(value.address, "8.8.8.8"); assert.equal(value.hostname, "game.example.test"); return status; } });
  assert.equal(result.state, "ONLINE");
  let connected = false;
  const timeout = await probeMinecraftAddress("game.example.test", { timeoutMs: 10, resolve: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return target; }, status: async () => { connected = true; return status; } });
  assert.equal(timeout.state, "OFFLINE"); assert(timeout.message.includes("超时"));
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(connected, false);
});

test("cached requests deduplicate the same address, expire and bound simultaneous TCP probes", async () => {
  let calls = 0, active = 0, peak = 0;
  const cached = createProbeCache(async address => {
    calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return onlineProbe(address, { version: "1.21.1", playersOnline: 0, latencyKind: "PONG", latencyMs: 5 });
  }, 20);
  const [a, b] = await Promise.all([cached("one"), cached("one")]); assert.equal(a, b); assert.equal(calls, 1);
  await cached("one"); assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 30)); await cached("one"); assert.equal(calls, 2);
  await Promise.all(Array.from({ length: 12 }, (_, index) => cached(String(index)))); assert.equal(peak, 4);
});
