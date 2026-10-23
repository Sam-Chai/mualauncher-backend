import assert from "node:assert/strict";
import { test } from "node:test";
import { createS3Storage } from "../src/lib/object-storage/s3";
import { createAliStorage } from "../src/lib/object-storage/ali";
import { createTencentStorage } from "../src/lib/object-storage/tencent";
import { createHuaweiStorage } from "../src/lib/object-storage/huawei";
import { storageConfiguration } from "../src/lib/object-storage/config";
import { validUploadSignature } from "./fixtures/upload-signature";

for (const provider of ["aws", "ali", "tencent", "huawei"] as const) {
  test(`${provider} authenticates exact part length; altered length or absent header fails verification`, async t => {
    const config = storageConfiguration({ OSS_PROVIDER: provider, OSS_REGION: provider === "aws" ? "us-east-1" : "cn-test-1",
      OSS_ACCESS_KEY_ID: "test-id", OSS_SECRET_ACCESS_KEY: "test-secret", ...(provider === "aws" ? {} : { OSS_ENDPOINT: provider === "tencent" ? "https://{bucket}.storage.test" : "https://storage.test" }) });
    const client = provider === "aws" ? createS3Storage(config) : provider === "ali" ? createAliStorage(config) : provider === "tencent" ? createTencentStorage(config) : createHuaweiStorage(config);
    t.after(() => client.destroy());
    const bucket = provider === "tencent" ? "test-bucket-1234567890" : "test-bucket";
    for (const ContentLength of [1, 64 * 1024 * 1024, 17]) {
      const url = new URL(await client.signUploadPart({ Bucket: bucket, Key: "uploads/空 格+%/source.zip", UploadId: "upload+id", PartNumber: 1, ContentLength }, { expiresIn: 600 }));
      const headers = { host: url.host, "content-length": String(ContentLength) };
      assert.equal(validUploadSignature(provider, url, headers, bucket), true, "the real SDK's signature must verify with the expected length");
      for (const length of [ContentLength + 1, Math.max(0, ContentLength - 1)]) assert.equal(validUploadSignature(provider, url, { ...headers, "content-length": String(length) }, bucket), false);
      assert.equal(validUploadSignature(provider, url, { host: url.host }, bucket), false, "chunked requests without a length must not verify");
    }
  });
}

test("Huawei V4 part signing preserves temporary credentials and custom domain host binding", async t => {
  for (const customDomain of [false, true]) {
    const client = createHuaweiStorage(storageConfiguration({ OSS_PROVIDER: "huawei", OSS_REGION: "cn-test-1", OSS_ACCESS_KEY_ID: "test-id", OSS_SECRET_ACCESS_KEY: "test-secret",
      OSS_SESSION_TOKEN: "temporary-token", OSS_ENDPOINT: customDomain ? "https://{bucket}.custom.test" : "https://storage.test", OSS_CUSTOM_DOMAIN: String(customDomain) }));
    t.after(() => client.destroy());
    const url = new URL(await client.signUploadPart({ Bucket: "test-bucket", Key: "source.zip", UploadId: "id", PartNumber: 1, ContentLength: 17 }, { expiresIn: 600 }));
    assert.equal(url.hostname, customDomain ? "test-bucket.custom.test" : "test-bucket.storage.test");
    assert.equal(url.searchParams.get("x-amz-security-token"), "temporary-token");
    assert(validUploadSignature("huawei", url, { host: url.host, "content-length": "17" }, "test-bucket"));
  }
});
