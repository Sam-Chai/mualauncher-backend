import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverId } from "@/lib/input";
import { publicManifest } from "@/lib/client-download";
import { failure } from "@/lib/http";
export async function GET(request: Request, context: { params: Promise<{ serverId: string }> }) {
  await connection();
  try {
    const result = await publicManifest(prisma, serverId((await context.params).serverId), new URL(request.url).searchParams.get("acceptedFormatVersions"));
    return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-MUA-Manifest-Sha256": result.release.manifestSha256, "X-MUA-Signing-Key": result.release.signingKeyId,
      "X-MUA-Signature": result.release.signature, "X-MUA-Signature-Algorithm": "Ed25519", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
