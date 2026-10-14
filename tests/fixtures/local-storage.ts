import assert from "node:assert/strict";

// Integration tests create/delete buckets. Never inherit a production cloud provider or OSS bucket override.
export function configureLocalTestStorage() {
  const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname), "Storage integration tests require a local MinIO endpoint");
  process.env.OSS_PROVIDER = "minio";
  process.env.OSS_ENDPOINT = endpoint;
  process.env.OSS_REGION = process.env.S3_REGION ?? "us-east-1";
  process.env.OSS_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
  process.env.OSS_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
  process.env.OSS_FORCE_PATH_STYLE = "true";
  process.env.OSS_CUSTOM_DOMAIN = "false";
  delete process.env.OSS_SESSION_TOKEN;
  for (const kind of ["PACKAGES", "CAS", "ENVIRONMENTS"]) {
    const value = process.env[`S3_${kind}_BUCKET`];
    if (value) process.env[`OSS_${kind}_BUCKET`] = value; else delete process.env[`OSS_${kind}_BUCKET`];
  }
}
