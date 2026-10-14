import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { initializeStorage } from "../src/lib/storage";
import { signingIdentity } from "../src/lib/signing";

async function main() {
  await initializeStorage();
  const path = process.env.SIGNING_PRIVATE_KEY_PATH;
  if (!path) throw new Error("Configure SIGNING_PRIVATE_KEY_PATH before initialization");
  await mkdir(dirname(path), { recursive: true });
  const { privateKey } = generateKeyPairSync("ed25519");
  try { await writeFile(path, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
  const identity = await signingIdentity();
  console.log(`Private object storage buckets ready (${process.env.OSS_PROVIDER ?? "minio"}); Ed25519 key ID: ${identity.keyId}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Initialization failed"); process.exitCode = 1; });
