import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import { sensitivePackPath, assertDistributableFiles } from "../src/lib/pack-file-policy";
import { parseClientPack } from "../src/lib/pack-parser";

const privatePaths = ["accounts.json", "ACCOUNTS.JSON.bak", "launcher_accounts_microsoft_store.json", "launcher_profiles.json_old",
  "config/accounts.json", "versions/custom/accounts.json", ".env.production", "config/.netrc", ".git/config", ".ssh/id_ed25519", ".aws/credentials",
  "config/.azure/accessTokens.json", "PCL/Setup.ini", ".hmcl/accounts.json", ".mua/session.json", "hmcl.json.bak", "private/account-private-data.json", "private/user-account-private-data.json", "config/user-accounts.json"];
test("shared privacy policy catches credentials and backups while preserving ordinary mod and player configuration", () => {
  for (const path of privatePaths) { assert(sensitivePackPath(path), path); assert.throws(() => assertDistributableFiles([{ path }]), /Sensitive files/); }
  for (const path of ["versions/pcl/pcl.json", "versions/pcl/mods/a.jar", "config/example.json", "config/authentication-settings.toml", "resourcepacks/example.zip", "mods/a.jar", "options.txt", "servers.dat", "saves/world/level.dat", "config/public.pem", "config/accounts-example.json"])
    assert.equal(sensitivePackPath(path), false, path);
  assert.doesNotThrow(() => assertDistributableFiles([{ root: "java", path: ".env" }]));
});
async function archive(files: Record<string, Buffer>) {
  const zip = new ZipFile(), chunks: Buffer[] = [];
  const complete = (async () => { for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk); })();
  for (const [path, bytes] of Object.entries(files)) zip.addBuffer(bytes, path);
  zip.end(); await complete; return Buffer.concat(chunks);
}
for (const mode of ["minecraft", "mrpack-v1", "mrpack-v2", "pcl-v1", "pcl-v2"]) test(`${mode} filters sensitive files before CAS, remote download and import diagnostics`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mua-private-pack-"));
  try {
    const secret = Buffer.from("EXPOSED-CREDENTIAL-FIXTURE"), good = Buffer.from("normal-config");
    const entries: Record<string, Buffer> = {};
    const mrpack = mode !== "minecraft";
    for (const path of privatePaths) entries[(mrpack ? "overrides/" : ".minecraft/") + path] = secret;
    entries[(mrpack ? "client-overrides/" : ".minecraft/") + "config/good.json"] = good;
    if (mrpack) entries["modrinth.index.json"] = Buffer.from(JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Policy fixture", versionId: "1.0.0", dependencies: { minecraft: "26.1" },
      files: [{ path: "accounts.json", fileSize: 1, hashes: { sha1: "a".repeat(40), sha512: "b".repeat(128) }, downloads: ["https://cdn.modrinth.com/private-token-fixture"] }] }));
    else entries[".minecraft/versions/test/test.json"] = Buffer.from(JSON.stringify({ id: "test", clientVersion: "26.1", javaVersion: { majorVersion: 25 } }));
    let bytes = await archive(entries);
    if (mode.startsWith("pcl")) bytes = await archive({ "pack.mrpack": bytes, "PCL/Setup.ini": secret });
    const path = join(dir, "source.zip"); await writeFile(path, bytes);
    const stored: Buffer[] = [];
    const result = await parseClientPack(path, dir, [], null, bytes.length, () => {}, undefined, {
      packageFormatVersion: mode.endsWith("v2") ? 2 : 1,
      storeCas: async (_hash, path) => { stored.push(await readFile(path)); return true; },
      downloadFile: async () => { throw new Error("Sensitive remote file must never be downloaded"); },
    });
    assert(result); assert(stored.some(bytes => bytes.equals(good))); assert(stored.every(bytes => !bytes.equals(secret)));
    const files = "recipeInventory" in result && result.recipeInventory ? result.recipeInventory.files : result.files;
    assert(files.some(file => file.path === "config/good.json")); assert(files.every(file => !sensitivePackPath(file.path)));
    assert(result.warnings.some(warning => warning.includes("diagnostics.packPolicy.filtered")));
    assert(!JSON.stringify(result).includes("private-token-fixture")); assert(!JSON.stringify(result).includes(secret.toString()));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
