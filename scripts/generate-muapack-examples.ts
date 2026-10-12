import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { muaFixtureDocuments } from "../tests/fixtures/muapack";

// Documentation fixtures only: no network, real runtime, production keys or database.
async function main() {
  const root = resolve("docs/examples/muapack");
  for (const update of [false, true]) {
    const fixture = muaFixtureDocuments(update); const folder = resolve(root, update ? "update" : "full");
    const documents = new Map<string, Buffer>([["mua-pack.json", fixture.metadataBytes], ["metadata/target-manifest.json", fixture.targetBytes]]);
    if (fixture.baseBytes) documents.set("metadata/base-manifest.json", fixture.baseBytes);
    for (const [hash, bytes] of fixture.environmentDocuments) documents.set(`metadata/environments/${hash}.json`, bytes);
    for (const [path, bytes] of documents) {
      const target = resolve(folder, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
  }
  console.log("已生成 docs/examples/muapack 的合成 JSON 示例；不是可安装的游戏包。");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "示例生成失败"); process.exitCode = 1; });
