import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentConfiguration } from "../scripts/lib/deployment-config";
import { environmentFromFiles } from "../scripts/with-env.mjs";

function configuration(role: "web" | "worker" | "all"): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production", APP_ORIGIN: "https://link.mua.edu.cn", OSS_PROVIDER: "minio",
    OSS_ENDPOINT: "https://objects.mua.edu.cn", OSS_ACCESS_KEY_ID: "restricted-storage", OSS_SECRET_ACCESS_KEY: "test-secret",
    OSS_PACKAGES_BUCKET: "test-packages", OSS_CAS_BUCKET: "test-cas", OSS_ENVIRONMENTS_BUCKET: "test-environments",
    SIGNING_PRIVATE_KEY_PATH: join(tmpdir(), "deployment-key.pem"), TMPDIR: tmpdir(), FORGE_PROCESSOR_JAVA: "java",
  };
  if (role !== "worker") Object.assign(env, {
    DATABASE_URL: "postgresql://mua_web:secret@localhost/test", DATABASE_AUTH_URL: "postgresql://mua_auth:secret@localhost/test",
    DATABASE_PUBLIC_URL: "postgresql://mua_public:secret@localhost/test",
  });
  if (role !== "web") env.DATABASE_WORKER_URL = "postgresql://mua_worker:secret@localhost/test";
  if (role === "all") env.DATABASE_MIGRATION_URL = "postgresql://mua_migrator:secret@localhost/test?options=-c%20role%3Dmua_owner";
  return env;
}

test("deployment scope rejects privileged or unrelated database credentials and SET ROLE runtime logins", () => {
  for (const role of ["web", "worker", "all"] as const) assert.deepEqual(deploymentConfiguration(configuration(role), role, "24.13.0"), []);
  const web = configuration("web");
  for (const key of ["DATABASE_ADMIN_URL", "DATABASE_MIGRATION_URL", "DATABASE_WORKER_URL"]) {
    assert(deploymentConfiguration({ ...web, [key]: "postgresql://postgres:secret@localhost/test" }, "web", "24.13.0").some(error => error.includes(key)));
  }
  for (const url of ["postgresql://postgres:secret@localhost/test", "postgresql://mua_web:secret@localhost/test?options=-c%20role%3Dmua_owner", "postgresql://mua_web:CHANGE_ME_WEB_PASSWORD@localhost/test"]) {
    assert(deploymentConfiguration({ ...web, DATABASE_URL: url }, "web", "24.13.0").some(error => error.includes("DATABASE_URL")));
  }
  assert(deploymentConfiguration({ ...configuration("worker"), DATABASE_URL: web.DATABASE_URL }, "worker", "24.13.0").some(error => error.includes("DATABASE_URL")));
});

test("deployment rejects local HTTP distribution, invalid origin, default credentials, shared buckets and missing persistent paths", () => {
  const valid = configuration("worker");
  for (const patch of [
    { APP_ORIGIN: "http://localhost:3001" }, { APP_ORIGIN: "https://link.mua.edu.cn/" },
    { OSS_ENDPOINT: "http://127.0.0.1:9000" }, { OSS_ACCESS_KEY_ID: "minioadmin" },
    { OSS_CAS_BUCKET: valid.OSS_PACKAGES_BUCKET }, { TMPDIR: ".local/tmp" },
    { SIGNING_PRIVATE_KEY_PATH: join(process.cwd(), ".local/key.pem") }, { FORGE_PROCESSOR_JAVA: "" },
  ]) assert(deploymentConfiguration({ ...valid, ...patch }, "worker", "24.13.0").length, JSON.stringify(Object.keys(patch)));
  assert(deploymentConfiguration(valid, "worker", "22.15.0").some(error => error.includes("Node")));
});

test("external env loading removes inherited administrator credentials and preserves literal secrets without shell expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "union-link-env-"));
  try {
    const common = join(dir, "common.env"), web = join(dir, "web.env");
    await writeFile(common, 'NODE_ENV="production"\nOSS_SECRET_ACCESS_KEY=\'literal$secret#with spaces\'\n');
    await writeFile(web, 'DATABASE_URL="postgresql://mua_web:secret@localhost/test"\n');
    const env = await environmentFromFiles([common, web], { NODE_ENV: "production", DATABASE_ADMIN_URL: "must-not-leak", DATABASE_WORKER_URL: "must-not-leak", DATABASE_SCHEMA: "old", DOTENV_CONFIG_OVERRIDE: "true", PATH: "preserved" });
    assert.equal(env.DATABASE_ADMIN_URL, undefined); assert.equal(env.DATABASE_WORKER_URL, undefined); assert.equal(env.DATABASE_SCHEMA, undefined);
    assert.equal(env.DATABASE_URL, "postgresql://mua_web:secret@localhost/test"); assert.equal(env.OSS_SECRET_ACCESS_KEY, "literal$secret#with spaces");
    assert.equal(env.PATH, "preserved"); assert.equal(env.DOTENV_CONFIG_PATH, web); assert.equal(env.DOTENV_CONFIG_OVERRIDE, undefined);
  } finally {
    assert(dir.startsWith(join(tmpdir(), "union-link-env-")));
    await rm(dir, { recursive: true, force: true });
  }
});
