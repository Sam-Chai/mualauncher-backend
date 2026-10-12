import { readFile } from "node:fs/promises";
import { createPublicKey } from "node:crypto";
import { validateMuaPackArchive, muaArchiveFormat } from "../src/lib/muapack-archive";
import { validateRecipePackArchive } from "../src/lib/muapack-v2-archive";

async function main() {
  const [pack, publicKeyPath, ...extra] = process.argv.slice(2);
  if (!pack || !publicKeyPath || extra.length) throw new Error("用法：npm run muapack:validate -- client.muapack trusted-public-key.pem");
  const trustedKey = createPublicKey(await readFile(publicKeyPath));
  if (await muaArchiveFormat(pack) === 2) {
    const result = await validateRecipePackArchive(pack, trustedKey);
    console.log(JSON.stringify({ valid: true, formatVersion: 2, packageType: result.metadata.packageType,
      ...("supportedPlatforms" in result.target ? { supportedPlatforms: result.target.supportedPlatforms } : { protocolRevision: result.target.protocolRevision }),
      base: result.metadata.base?.version ?? null, target: result.metadata.target.version, releaseId: result.metadata.target.releaseId,
      objectCount: result.objectCount, payloadSize: result.payloadSize, keyId: result.signature.keyId }, null, 2)); return;
  }
  const result = await validateMuaPackArchive(pack, trustedKey);
  console.log(JSON.stringify({ valid: true, packageType: result.metadata.packageType, platform: result.metadata.platform,
    base: result.metadata.base?.version ?? null, target: result.metadata.target.version, releaseId: result.metadata.target.releaseId,
    objectCount: result.objectCount, payloadSize: result.payloadSize, keyId: result.signature.keyId }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "muapack 校验失败"); process.exitCode = 1; });
