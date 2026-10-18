import { isAbsolute, resolve, relative } from "node:path";
import { storageConfiguration, storageBucket } from "../../src/lib/object-storage/config";

export type DeploymentRole = "web" | "worker" | "all";
const keys = { web: "DATABASE_URL", auth: "DATABASE_AUTH_URL", public: "DATABASE_PUBLIC_URL", worker: "DATABASE_WORKER_URL", migration: "DATABASE_MIGRATION_URL" };
export const databasePurposes = (role: DeploymentRole) => role === "web" ? ["web", "auth", "public"] as const : role === "worker" ? ["worker"] as const : ["web", "auth", "public", "worker"] as const;

export function deploymentConfiguration(env: NodeJS.ProcessEnv, role: DeploymentRole, nodeVersion = process.versions.node) {
  const errors: string[] = [];
  const required = (key: string) => {
    const value = env[key];
    if (!value || /^(CHANGE_ME|YOUR_|REPLACE_|.*_PASSWORD$)/.test(value)) errors.push(`${key} must be configured`);
    return value;
  };
  if (Number(nodeVersion.split(".")[0]) !== 24) errors.push("Use Node.js 24.x for this release");
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production");
  try {
    const origin = new URL(required("APP_ORIGIN") ?? "");
    if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN || origin.username || origin.password || /^(localhost|127\.|\[::1\])/.test(origin.hostname) || origin.hostname.endsWith(".example")) throw new Error();
  } catch { errors.push("APP_ORIGIN must be the exact public HTTPS origin without a trailing slash"); }
  if (env.DATABASE_SCHEMA && env.DATABASE_SCHEMA !== "public") errors.push("Server deployments use the public schema");
  const purposes = [...databasePurposes(role), ...(role === "all" ? ["migration" as const] : [])];
  for (const [purpose, key] of Object.entries(keys)) {
    if (!purposes.includes(purpose as typeof purposes[number])) {
      if (env[key]) errors.push(`${key} must not be supplied to ${role}`);
      continue;
    }
    const login = purpose === "migration" ? "mua_migrator" : `mua_${purpose}`;
    try {
      const url = new URL(required(key) ?? "");
      if (!["postgres:", "postgresql:"].includes(url.protocol) || decodeURIComponent(url.username) !== login || !url.password || /^(CHANGE_ME|YOUR_|.*_PASSWORD$)/.test(decodeURIComponent(url.password))) throw new Error();
      if (purpose !== "migration" && url.searchParams.has("options")) throw new Error();
      if (purpose === "migration" && !/(?:^|\s)role=mua_owner(?:\s|$)/.test(url.searchParams.get("options") ?? "")) throw new Error();
    } catch { errors.push(`${key} must use its dedicated ${login} login and a real password; runtime URLs must not SET ROLE`); }
  }
  if (env.DATABASE_ADMIN_URL) errors.push("DATABASE_ADMIN_URL must only be used for explicit provisioning");
  try {
    const config = storageConfiguration(env);
    if (config.endpoint) {
      const endpoint = new URL(config.endpoint.replaceAll("{bucket}", "example-bucket"));
      if (endpoint.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(endpoint.hostname)) errors.push("OSS_ENDPOINT must be browser-accessible HTTPS, not a loopback/internal HTTP endpoint");
    }
    for (const key of ["ACCESS_KEY_ID", "SECRET_ACCESS_KEY"]) {
      const value = env[`OSS_${key}`] ?? env[`S3_${key}`];
      if (value === "minioadmin" || /^(CHANGE_ME|YOUR_|REPLACE_)/.test(value ?? "")) errors.push(`OSS_${key} must use dedicated storage credentials`);
    }
  } catch { errors.push("Object storage configuration is invalid; see docs/object-storage.md"); }
  const buckets = ["PACKAGES", "CAS", "ENVIRONMENTS"].map(kind => {
    const key = `OSS_${kind}_BUCKET`, value = env[key] ?? env[`S3_${kind}_BUCKET`];
    if (!value) errors.push(`${key} must be explicit`);
    return value;
  });
  if (new Set(buckets).size !== 3) errors.push("Use three distinct storage buckets");
  for (const key of ["SIGNING_PRIVATE_KEY_PATH", "TMPDIR"]) if (!required(key) || !isAbsolute(env[key]!)) errors.push(`${key} must be an absolute path outside the checkout`);
  for (const key of ["SIGNING_PRIVATE_KEY_PATH", "TMPDIR"]) {
    if (env[key] && isAbsolute(env[key]!)) {
      const path = relative(process.cwd(), resolve(env[key]!));
      if (!path.startsWith("..") && !isAbsolute(path)) errors.push(`${key} must be outside the checkout`);
    }
  }
  if (role !== "web" && !env.FORGE_PROCESSOR_JAVA) errors.push("FORGE_PROCESSOR_JAVA must name the Worker host Java executable");
  return errors;
}

export const configuredBuckets = () => (["PACKAGES", "CAS", "ENVIRONMENTS"] as const).map(storageBucket);
