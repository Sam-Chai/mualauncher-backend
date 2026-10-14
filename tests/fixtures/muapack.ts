import { encodeMuaJson, muaDigest, createMuaPackMetadata } from "../../src/lib/muapack-protocol";
import { muaEnvironmentManifestSchema, muaPlatformManifestSchema, type MuaFile, type MuaPlatform } from "../../src/lib/muapack-contract";

/** Synthetic bytes: exercises the format, not an installable Minecraft distribution. */
export function muaFixture(version = "1.0.0", platform: MuaPlatform = "windows-amd64") {
  const objects = new Map<string, Buffer>();
  function file(root: MuaFile["root"], path: string, content: string, policy: MuaFile["policy"] = "managed", executable = false): MuaFile {
    const bytes = Buffer.from(content); const sha256 = muaDigest(bytes); objects.set(sha256, bytes);
    return { root, path, sha256, size: bytes.length, policy, executable };
  }
  const javaPath = platform.startsWith("windows") ? "bin/java.exe" : "bin/java";
  const minecraftFile = file("instance", "versions/26.1/26.1.jar", "synthetic game");
  const loaderFile = file("instance", "libraries/fabric-loader-0.19.5.jar", "synthetic loader");
  const javaFile = file("java", javaPath, "synthetic Java", "managed", true);
  const environmentDocuments = new Map<string, Buffer>();
  const javaIdentity = { major: 25, vendor: "example", version: "25.0.0", build: "1", imageType: "jre" as const, executable: javaPath, archiveSha256: muaDigest(Buffer.from("synthetic archive")) };
  function environment(value: unknown) {
    const document = muaEnvironmentManifestSchema.parse(value); const bytes = encodeMuaJson(document); const sha256 = muaDigest(bytes);
    environmentDocuments.set(sha256, bytes); return { kind: document.kind, sha256 };
  }
  const common = { format: "mua-environment-manifest", formatVersion: 1, resolverVersion: "example-1", platform };
  const environments = [
    environment({ ...common, kind: "minecraft", minecraft: "26.1", sourceMetadataSha256: muaDigest(Buffer.from("synthetic game metadata")), files: [minecraftFile] }),
    environment({ ...common, kind: "loader", minecraft: "26.1", loader: { type: "fabric", version: "0.19.5" },
      sourceMetadataSha256: muaDigest(Buffer.from("synthetic loader metadata")), files: [loaderFile] }),
    environment({ ...common, kind: "java", java: javaIdentity, files: [javaFile] }),
  ];
  const manifest = muaPlatformManifestSchema.parse({ format: "mua-platform-manifest", formatVersion: 1,
    release: { organizationId: "11111111-1111-4111-8111-111111111111", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", releaseId: version === "1.0.0" ?
      "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333", version, name: "NPU 示例", summary: "协议测试", description: "Synthetic fixture; not runnable.",
      sourceSha256: muaDigest(Buffer.from(`synthetic source ${version}`)), contentRevision: 1 },
    platform, runtime: { minecraft: "26.1", loader: { type: "fabric", version: "0.19.5" },
      java: { major: javaIdentity.major, vendor: javaIdentity.vendor, version: javaIdentity.version, build: javaIdentity.build, imageType: javaIdentity.imageType,
        executable: javaPath, manifestSha256: environments[2].sha256 } }, environments,
    launch: { mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient", classpath: [minecraftFile.path, loaderFile.path],
      jvmArgs: ["-Dexample=true"], gameArgs: ["--username", "${auth_player_name}"],
      memory: { mode: "auto", minimumMiB: 2048, recommendedMiB: 4096 }, preLaunch: [] },
    mods: [{ path: "mods/example.jar", name: null, version: null }],
    files: [minecraftFile, loaderFile, javaFile, file("instance", "mods/example.jar", `synthetic mod ${version}`),
      file("instance", "options.txt", "synthetic options", "preserve"),
      ...(version === "1.0.0" ? [file("instance", "mods/removed.jar", "old mod")] : [file("instance", "config/new.json", "{}")])],
  });
  const targetBytes = encodeMuaJson(manifest);
  return { manifest, targetBytes, objects, environmentDocuments, file };
}
export function muaFixtureDocuments(update = false) {
  const target = muaFixture(update ? "1.0.1" : "1.0.0");
  const baseBytes = update ? muaFixture().targetBytes : null;
  const metadata = createMuaPackMetadata(target.targetBytes, baseBytes, "backup-managed");
  return { ...target, baseBytes, metadata, metadataBytes: encodeMuaJson(metadata) };
}
