import "dotenv/config";
import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createPrivateKey, createPublicKey, createHash } from "node:crypto";
import { deploymentConfiguration, databasePurposes, configuredBuckets, type DeploymentRole } from "./lib/deployment-config";
import { validateDatabase, disconnectDatabases } from "../src/lib/prisma";
import { executionPolicy } from "../src/lib/execution-policy";
import { DockerExecutionBackend } from "../src/lib/execution-docker";
import { storageClient } from "../src/lib/storage";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--role" || !["web", "worker", "all"].includes(args[1])) throw new Error("Usage: npm run deployment:check -- --role web|worker|all");
  const role = args[1] as DeploymentRole;
  const errors = deploymentConfiguration(process.env, role);
  const localEnvFiles = (await readdir(".")).filter(file => /^\.env(?:\.(?:local|production|production\.local))?$/.test(file));
  if (localEnvFiles.length) errors.push("Remove checkout .env/.env.local/.env.production* files; use external role-specific server configuration");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Deployment configuration OK (${role}, Node 24, HTTPS, separated credentials)`);
  const keyPath = process.env.SIGNING_PRIVATE_KEY_PATH!;
  const info = await stat(keyPath);
  if (!info.isFile() || process.platform !== "win32" && (info.mode & 0o027)) throw new Error("Signing key must be a regular protected file (0600 or 0640)");
  const key = createPrivateKey(await readFile(keyPath));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be Ed25519");
  const keyId = createHash("sha256").update(createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex").slice(0, 24);
  console.log(`Protected signing key OK (key ID: ${keyId})`);
  await access(process.env.TMPDIR!, constants.W_OK | constants.X_OK);
  if (!(await stat(process.env.TMPDIR!)).isDirectory()) throw new Error("TMPDIR must be an existing writable directory");
  if (role !== "worker") {
    const dist = resolve(process.env.NEXT_DIST_DIR ?? ".next"), path = relative(process.cwd(), dist);
    if (path.startsWith("..") || isAbsolute(path)) throw new Error("NEXT_DIST_DIR must stay inside the checkout");
    await access(resolve(dist, "BUILD_ID"), constants.R_OK);
    console.log("Production Web build OK");
  }
  if (role !== "web") {
    await new DockerExecutionBackend(executionPolicy()).probe();
    console.log("Docker Linux daemon, runsc and isolated Java 21 execution verified");
  }
  for (const purpose of databasePurposes(role)) { await validateDatabase(purpose); console.log(`Database identity and FORCE RLS OK (${purpose})`); }
  for (const Bucket of configuredBuckets()) await storageClient().headBucket({ Bucket });
  console.log("Three storage buckets readable. Run storage:verify separately for write/immutability capabilities, then verify browser CORS.");
  console.log("Deployment preflight passed; target end-to-end and backup/restore acceptance remain required.");
}

const timeout = setTimeout(() => { console.error("Deployment preflight timed out"); process.exit(1); }, 120_000);
void main().catch(error => {
  // Only print our fixed validation messages. SDK/SQL/Java errors can contain credentials.
  const message = error instanceof Error ? error.message : "";
  const safe = /^(Usage:|Use Node|NODE_ENV|APP_ORIGIN|DATABASE_|Server deployments|Object storage|OSS_|Use three|SIGNING_PRIVATE_KEY_PATH|TMPDIR|SANDBOX_|Remove checkout|Signing key must|NEXT_DIST_DIR|Worker host Java)/.test(message);
  console.error(safe ? message : "Deployment preflight failed; check key/build/temp paths, Docker/gVisor, restricted database roles and bucket access. Credentials were not printed.");
  process.exitCode = 1;
}).finally(async () => { clearTimeout(timeout); await disconnectDatabases(); });
