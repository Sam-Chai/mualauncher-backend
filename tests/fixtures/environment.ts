
import { storageClient, environmentsBucket, casKey } from "../../src/lib/storage";
import { putImmutableBytes } from "../../src/lib/package-storage";
import { encodeMuaJson, muaDigest } from "../../src/lib/muapack-protocol";
import { muaEnvironmentManifestSchema, type MuaFile } from "../../src/lib/muapack-contract";
import type { EnvironmentResolver, ResolvedEnvironment } from "../../src/lib/environment-resolver";

/** Injected through the Worker function only; production never selects synthetic environments. */
export const fixtureEnvironment: EnvironmentResolver = async (request, _directory, signal, progress) => {
  signal.throwIfAborted(); await progress("Preparing synthetic test environment");
  const files: MuaFile[] = [];
  async function file(root: MuaFile["root"], path: string, content: string, executable = false) {
    const bytes = Buffer.from(content), sha256 = muaDigest(bytes);
    await storageClient().putObject({ Bucket: environmentsBucket(), Key: casKey(sha256), Body: bytes, Metadata: { sha256 } });
    const file = { root, path, sha256, size: bytes.length, policy: "managed" as const, executable }; files.push(file); return file;
  }
  const gameFile = await file("instance", `versions/${request.minecraft}/${request.minecraft}.jar`, `synthetic game ${request.minecraft}`);
  const javaFile = await file("java", request.platform.startsWith("windows") ? "bin/java.exe" : "bin/java", `synthetic Java ${request.javaMajor} ${request.platform}`, true);
  const java = { major: request.javaMajor, vendor: "synthetic", version: String(request.javaMajor), build: "test", imageType: "jre" as const, executable: javaFile.path };
  const common = { format: "mua-environment-manifest", formatVersion: 1, platform: request.platform, resolverVersion: "test-1" };
  const environments: ResolvedEnvironment["environments"] = [];
  async function document(value: unknown) {
    const parsed = muaEnvironmentManifestSchema.parse(value), bytes = encodeMuaJson(parsed), sha256 = muaDigest(bytes);
    await putImmutableBytes(environmentsBucket(), `manifests/${sha256}.json`, bytes); const ref = { kind: parsed.kind, sha256 }; environments.push(ref); return ref;
  }
  await document({ ...common, kind: "minecraft", minecraft: request.minecraft, sourceMetadataSha256: muaDigest(Buffer.from("test metadata")), files: [gameFile] });
  const javaRef = await document({ ...common, kind: "java", java: { ...java, archiveSha256: muaDigest(Buffer.from("test archive")) }, files: [javaFile] });
  const classpath = [gameFile.path];
  if (request.loader) {
    const loaderFile = await file("instance", "libraries/test-loader.jar", `synthetic ${request.loader.type} ${request.loader.version}`); classpath.push(loaderFile.path);
    await document({ ...common, kind: "loader", minecraft: request.minecraft, loader: request.loader, sourceMetadataSha256: muaDigest(Buffer.from("test loader")), files: [loaderFile] });
  }
  return { minecraft: request.minecraft, loader: request.loader, java: { ...java, manifestSha256: javaRef.sha256 }, files, environments,
    launch: { mainClass: "net.minecraft.client.Main", classpath, jvmArgs: [], gameArgs: [], memory: { mode: "auto", minimumMiB: 1024, recommendedMiB: 2048 }, preLaunch: [] } };
};
