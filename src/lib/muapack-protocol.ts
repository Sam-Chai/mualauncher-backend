import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { invariant } from "./errors";
import { diffMuaFiles, muaEnvironmentManifestSchema, muaFileKey, muaPackMetadataSchema, muaPlatformManifestSchema,
  requiredMuaObjects, sameMuaFile, sha256Schema, type MuaEnvironmentManifest, type MuaPackMetadata,
  type MuaPlatformManifest } from "./muapack-contract";

export const MUA_METADATA_LIMIT = 16 * 1024 ** 2;
const DOMAIN = Buffer.from("MUA-MUAPACK-V1\0", "ascii");
export function muaDigest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

/** Protocol JSON: UTF-8, sorted object keys, array order preserved, no BOM/newline. */
export function encodeMuaJson(value: unknown): Buffer {
  function serialize(input: unknown, depth = 0): string {
    invariant(depth <= 32, 422, diagnosticText("diagnostics.muapackProtocol.protocolJsonNestingExceeds32Levels"));
    if (input === null || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "string") {
      // Reject unpaired UTF-16 surrogates, which are not Unicode scalar values.
      invariant(![...input].some(character => character.length === 1 && /[\ud800-\udfff]/.test(character)), 422, diagnosticText("diagnostics.muapackProtocol.jsonContainsInvalidUnicode"));
      return JSON.stringify(input);
    }
    if (typeof input === "number") { invariant(Number.isSafeInteger(input), 422, diagnosticText("diagnostics.muapackProtocol.protocolNumbersMustBeSafeIntegers")); return JSON.stringify(input); }
    if (Array.isArray(input)) return `[${Array.from(input, value => serialize(value, depth + 1)).join(",")}]`;
    invariant(typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype, 422, diagnosticText("diagnostics.muapackProtocol.theProtocolAcceptsOnlyPlainJsonObjects"));
    return `{${Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, val]) => `${serialize(key, depth + 1)}:${serialize(val, depth + 1)}`).join(",")}}`;
  }
  const bytes = Buffer.from(serialize(value), "utf8");
  invariant(bytes.length <= MUA_METADATA_LIMIT, 422, diagnosticText("diagnostics.muapackProtocol.protocolJsonExceeds16Mib"));
  return bytes;
}
export function decodeMuaJson(bytes: Buffer): unknown {
  invariant(bytes.length <= MUA_METADATA_LIMIT, 422, diagnosticText("diagnostics.muapackProtocol.protocolJsonExceeds16Mib"));
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value: unknown = JSON.parse(decoded);
  invariant(encodeMuaJson(value).equals(bytes), 422, diagnosticText("diagnostics.muapackProtocol.protocolJsonMustUseDeterministicEncodingWithoutDuplicateKeysBom"));
  return value;
}
export function readMuaPlatformManifest(bytes: Buffer) { return muaPlatformManifestSchema.parse(decodeMuaJson(bytes)); }
function releaseRef(manifest: MuaPlatformManifest, bytes: Buffer) {
  const { organizationId, clientId, releaseId, version } = manifest.release;
  return { organizationId, clientId, releaseId, version, manifestSha256: muaDigest(bytes) };
}
export function createMuaPackMetadata(targetBytes: Buffer, baseBytes: Buffer | null,
  removalPolicy: MuaPackMetadata["removalPolicy"]): MuaPackMetadata {
  const target = readMuaPlatformManifest(targetBytes); const base = baseBytes ? readMuaPlatformManifest(baseBytes) : null;
  invariant(!base || base.platform === target.platform, 422, diagnosticText("diagnostics.muapackProtocol.theUpdateBaselineMustUseTheSamePlatform"));
  const changes = base ? diffMuaFiles(base.files, target.files) : { added: [], modified: [], removed: [], policyChanged: [] };
  // Detect contradictory size declarations even across different inventories.
  const sizes = new Map<string, number>();
  for (const file of [...(base?.files ?? []), ...target.files]) {
    invariant(!sizes.has(file.sha256) || sizes.get(file.sha256) === file.size, 422, diagnosticText("diagnostics.muapackProtocol.theBaselineAndTargetContainTheSameDigestWithDifferent")); sizes.set(file.sha256, file.size);
  }
  return muaPackMetadataSchema.parse({ format: "muapack", formatVersion: 1, packageType: base ? "update" : "full",
    platform: target.platform, base: base && baseBytes ? releaseRef(base, baseBytes) : null,
    target: releaseRef(target, targetBytes), changes, payload: requiredMuaObjects(target, base ? changes : null), removalPolicy });
}
export function validateMuaPackDocuments(metadataBytes: Buffer, targetBytes: Buffer, baseBytes: Buffer | null) {
  const metadata = muaPackMetadataSchema.parse(decodeMuaJson(metadataBytes));
  const expected = createMuaPackMetadata(targetBytes, baseBytes, metadata.removalPolicy);
  invariant(encodeMuaJson(expected).equals(metadataBytes), 422, diagnosticText("diagnostics.muapackProtocol.packageMetadataChangesOrPayloadDoNotMatchTheComplete"));
  return { metadata, target: readMuaPlatformManifest(targetBytes), base: baseBytes ? readMuaPlatformManifest(baseBytes) : null };
}
export function validateMuaEnvironments(target: MuaPlatformManifest, documents: ReadonlyMap<string, Buffer>) {
  invariant(documents.size === target.environments.length, 422, diagnosticText("diagnostics.muapackProtocol.theEnvironmentDocumentCountDoesNotMatch"));
  const files = new Map(target.files.map(file => [muaFileKey(file), file]));
  const parsed: MuaEnvironmentManifest[] = [];
  for (const reference of target.environments) {
    const bytes = documents.get(reference.sha256);
    invariant(bytes && muaDigest(bytes) === reference.sha256, 422, diagnosticText("diagnostics.muapackProtocol.anEnvironmentDocumentIsMissingOrItsDigestDoesNot"));
    const environment = muaEnvironmentManifestSchema.parse(decodeMuaJson(bytes));
    invariant(environment.kind === reference.kind && environment.platform === target.platform, 422, diagnosticText("diagnostics.muapackProtocol.theEnvironmentTypeOrPlatformDoesNotMatch"));
    if (environment.kind === "minecraft" || environment.kind === "loader") invariant(environment.minecraft === target.runtime.minecraft, 422, diagnosticText("diagnostics.muapackProtocol.theEnvironmentMinecraftVersionDoesNotMatch"));
    if (environment.kind === "loader") invariant(environment.loader.type === target.runtime.loader?.type && environment.loader.version === target.runtime.loader.version, 422, diagnosticText("diagnostics.muapackProtocol.theLoaderEnvironmentDoesNotMatch"));
    if (environment.kind === "java") {
      for (const key of ["major", "vendor", "version", "build", "imageType", "executable"] as const) invariant(environment.java[key] === target.runtime.java[key], 422, diagnosticText("diagnostics.muapackProtocol.theJavaBuildDoesNotMatch"));
    }
    for (const file of environment.files) {
      const actual = files.get(muaFileKey(file)); invariant(actual && sameMuaFile(actual, file), 422, diagnosticText("diagnostics.muapackProtocol.environmentFilesDoNotMatchTheCompleteTargetManifest"));
    }
    parsed.push(environment);
  }
  const javaFiles = new Map(parsed.find(environment => environment.kind === "java")!.files.map(file => [muaFileKey(file), file]));
  invariant(target.files.filter(file => file.root === "java").every(file => javaFiles.has(muaFileKey(file))), 422, diagnosticText("diagnostics.muapackProtocol.theJavaRootContainsFilesNotLockedToItsEnvironment"));
  return parsed;
}

export const muaSignatureSchema = z.object({ format: z.literal("mua-pack-signature"), formatVersion: z.literal(1),
  algorithm: z.literal("Ed25519"), keyId: z.string().regex(/^[0-9a-f]{24}$/), metadataSha256: sha256Schema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
export function muaSigningKeyId(publicKey: KeyObject) {
  invariant(publicKey.type === "public" && publicKey.asymmetricKeyType === "ed25519", 422, diagnosticText("diagnostics.muapackProtocol.theTrustedPublicKeyMustBeEd25519"));
  return muaDigest(publicKey.export({ format: "der", type: "spki" })).slice(0, 24);
}
export function signMuaPackMetadata(metadataBytes: Buffer, privateKey: KeyObject): Buffer {
  muaPackMetadataSchema.parse(decodeMuaJson(metadataBytes));
  invariant(privateKey.type === "private" && privateKey.asymmetricKeyType === "ed25519", 422, diagnosticText("diagnostics.muapackProtocol.theSigningPrivateKeyMustBeEd25519"));
  return encodeMuaJson(muaSignatureSchema.parse({ format: "mua-pack-signature", formatVersion: 1, algorithm: "Ed25519",
    keyId: muaSigningKeyId(createPublicKey(privateKey)), metadataSha256: muaDigest(metadataBytes),
    signature: sign(null, Buffer.concat([DOMAIN, metadataBytes]), privateKey).toString("base64") }));
}
export function verifyMuaPackSignature(metadataBytes: Buffer, signatureBytes: Buffer, trustedPublicKey: KeyObject) {
  const signature = muaSignatureSchema.parse(decodeMuaJson(signatureBytes));
  invariant(signature.keyId === muaSigningKeyId(trustedPublicKey) && signature.metadataSha256 === muaDigest(metadataBytes), 422, diagnosticText("diagnostics.muapackProtocol.theSignatureIdentityOrMetadataDigestDoesNotMatch"));
  const bytes = Buffer.from(signature.signature, "base64");
  invariant(bytes.toString("base64") === signature.signature && verify(null, Buffer.concat([DOMAIN, metadataBytes]), trustedPublicKey, bytes), 422, diagnosticText("diagnostics.muapackProtocol.muapackSignatureVerificationFailed"));
  return signature;
}
