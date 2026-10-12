import "server-only";
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { invariant } from "./errors";
import { encodeMuaJson, decodeMuaJson, muaDigest, muaSigningKeyId } from "./muapack-protocol";
import { recipeContentSchema, recipeManifestSchema, recipePackMetadataSchema, recipeSignatureSchema, type RecipeManifest, type RecipePackMetadata } from "./muapack-v2-contract";
import { remoteSourceUrl } from "./remote-download";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "./download-sources";

const DOMAIN = Buffer.from("MUA-MUAPACK-V2\0", "ascii");
const equal = (a: unknown, b: unknown) => encodeMuaJson(a).equals(encodeMuaJson(b));
function validateRemoteSources(target: { files: RecipeManifest["files"] }) {
  for (const file of target.files) if (file.source.type === "remote") for (const raw of file.source.downloads) {
    const url = remoteSourceUrl(raw, { remoteSourceWhitelistEnabled: false, remoteSourceHosts: [], downloadProxyEnabled: false, downloadProxyUrl: "", ...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS });
    invariant(url.hostname.includes(".") && !/(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(url.hostname.replace(/\.$/, "")), 422, "v2 远程来源不能指向本地域名");
  }
}
export function readRecipeContent(bytes: Buffer) { const target = recipeContentSchema.parse(decodeMuaJson(bytes)); validateRemoteSources(target); return target; }
export function readRecipeManifest(bytes: Buffer) { const target = recipeManifestSchema.parse(decodeMuaJson(bytes)); validateRemoteSources(target); return target; }
export function recipeTarget(contentBytes: Buffer, platforms: RecipeManifest["supportedPlatforms"]) {
  return recipeManifestSchema.parse({ ...readRecipeContent(contentBytes), format: "mua-recipe-manifest", supportedPlatforms: platforms });
}
export function recipeModrinthIndex(target: RecipeManifest) {
  const keys = { fabric: "fabric-loader", quilt: "quilt-loader", forge: "forge", neoforge: "neoforge" };
  return { formatVersion: 1, game: "minecraft", versionId: target.release.version, name: target.release.name, summary: target.release.summary,
    dependencies: { minecraft: target.runtime.minecraft, ...(target.runtime.loader ? { [keys[target.runtime.loader.type]]: target.runtime.loader.version } : {}) },
    files: target.files.filter(file => file.source.type === "remote").map(file => ({ path: file.path, hashes: file.hashes, fileSize: file.size,
      downloads: file.source.type === "remote" ? file.source.downloads : [], env: { client: file.optional ? "optional" : "required", server: "unsupported" } })) };
}
function reference(target: RecipeManifest, bytes: Buffer) { const { organizationId, clientId, releaseId, version } = target.release; return { organizationId, clientId, releaseId, version, manifestSha256: muaDigest(bytes) }; }
export function createRecipePackMetadata(targetBytes: Buffer, baseBytes: Buffer | null = null, removalPolicy: RecipePackMetadata["removalPolicy"] = "retain"): RecipePackMetadata {
  const target = readRecipeManifest(targetBytes), base = baseBytes ? readRecipeManifest(baseBytes) : null;
  invariant(!base || base.release.organizationId === target.release.organizationId && base.release.clientId === target.release.clientId &&
    base.release.releaseId !== target.release.releaseId && base.release.version !== target.release.version, 422, "v2 更新必须属于同一客户端的不同发布");
  const changes: RecipePackMetadata["changes"] = { added: [], modified: [], removed: [], policyChanged: [], sourceChanged: [], runtimeChanged: null, launchChanged: null, platformsChanged: null };
  const sizes = new Map<string, number>();
  for (const file of [...(base?.files ?? []), ...target.files]) {
    const id = "sha512" in file.hashes ? `remote:${file.hashes.sha512}` : `local:${file.hashes.sha256}`;
    invariant(!sizes.has(id) || sizes.get(id) === file.size, 422, "v2 基准与目标存在同摘要不同大小"); sizes.set(id, file.size);
  }
  if (base) {
    const before = new Map(base.files.map(file => [file.path, file])), after = new Set(target.files.map(file => file.path));
    for (const file of target.files) {
      const old = before.get(file.path); if (!old) { changes.added.push(file); continue; }
      const modified = old.source.type !== file.source.type || !equal(old.hashes, file.hashes) || old.size !== file.size || old.executable !== file.executable;
      if (modified) changes.modified.push({ before: old, after: file });
      if (old.optional !== file.optional || old.policy !== file.policy) changes.policyChanged.push({ before: old, after: file });
      if (!modified && old.source.type === "remote" && file.source.type === "remote" && !equal(old.source.downloads, file.source.downloads)) changes.sourceChanged.push({ before: old, after: file });
    }
    changes.removed = base.files.filter(file => !after.has(file.path));
    if (!equal(base.runtime, target.runtime)) changes.runtimeChanged = { before: base.runtime, after: target.runtime };
    if (!equal(base.launch, target.launch)) changes.launchChanged = { before: base.launch, after: target.launch };
    if (!equal(base.supportedPlatforms, target.supportedPlatforms)) changes.platformsChanged = { before: base.supportedPlatforms, after: target.supportedPlatforms };
  }
  const candidates = base ? [...changes.added, ...changes.modified.map(pair => pair.after), ...changes.policyChanged.map(pair => pair.after)] : target.files;
  const local = new Map(candidates.filter(file => file.source.type === "local").map(file => [file.path, file]));
  return recipePackMetadataSchema.parse({ format: "muapack", formatVersion: 2, packageType: base ? "update" : "full", target: reference(target, targetBytes), base: base && baseBytes ? reference(base, baseBytes) : null,
    indexSha256: muaDigest(encodeMuaJson(recipeModrinthIndex(target))), changes,
    payload: [...local.values()].map(file => ({ entry: file.source.type === "local" ? file.source.entry : "", sha256: file.hashes.sha256, size: file.size })).sort((a, b) => a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0),
    removalPolicy, minimumLauncherProtocol: 2 });
}
export function validateRecipePackDocuments(metadataBytes: Buffer, targetBytes: Buffer, baseBytes: Buffer | null, indexBytes: Buffer) {
  const metadata = recipePackMetadataSchema.parse(decodeMuaJson(metadataBytes));
  invariant(equal(createRecipePackMetadata(targetBytes, baseBytes, metadata.removalPolicy), metadata), 422, "v2 元数据、差异或载荷与完整清单不一致");
  const target = readRecipeManifest(targetBytes);
  invariant(encodeMuaJson(recipeModrinthIndex(target)).equals(indexBytes) && muaDigest(indexBytes) === metadata.indexSha256, 422, "v2 mrpack 索引与目标不一致");
  return { metadata, target, base: baseBytes ? readRecipeManifest(baseBytes) : null };
}
export function signRecipePackMetadata(bytes: Buffer, privateKey: KeyObject) {
  recipePackMetadataSchema.parse(decodeMuaJson(bytes)); invariant(privateKey.type === "private" && privateKey.asymmetricKeyType === "ed25519", 422, "v2 签名需要 Ed25519 私钥");
  return encodeMuaJson(recipeSignatureSchema.parse({ format: "mua-pack-signature", formatVersion: 2, algorithm: "Ed25519", keyId: muaSigningKeyId(createPublicKey(privateKey)),
    metadataSha256: muaDigest(bytes), signature: sign(null, Buffer.concat([DOMAIN, bytes]), privateKey).toString("base64") }));
}
export function verifyRecipePackSignature(bytes: Buffer, signatureBytes: Buffer, key: KeyObject) {
  const signature = recipeSignatureSchema.parse(decodeMuaJson(signatureBytes)); const decoded = Buffer.from(signature.signature, "base64");
  invariant(signature.keyId === muaSigningKeyId(key) && signature.metadataSha256 === muaDigest(bytes) && decoded.toString("base64") === signature.signature &&
    verify(null, Buffer.concat([DOMAIN, bytes]), key, decoded), 422, "v2 包签名验证失败"); return signature;
}
