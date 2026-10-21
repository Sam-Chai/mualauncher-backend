import { connection } from "next/server";
import { memberDistribution } from "@/lib/member-access";
import { serverId } from "@/lib/input";
import { publicManifest } from "@/lib/client-download";
import { failure } from "@/lib/http";
export async function GET(request: Request, context: { params: Promise<{ serverId: string }> }) {
  await connection();
  try {
    const sid = serverId((await context.params).serverId);
    const result = await memberDistribution(request, sid, null, db => publicManifest(db, sid, new URL(request.url).searchParams.get("acceptedFormatVersions")));
    return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization",
      "X-MUA-Manifest-Sha256": result.release.manifestSha256, "X-MUA-Signing-Key": result.release.signingKeyId,
      "X-MUA-Signature": result.release.signature, "X-MUA-Signature-Algorithm": "Ed25519", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
