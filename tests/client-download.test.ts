import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { Db } from "../src/lib/auth";
import { AppError } from "../src/lib/errors";
import { publicPackage } from "../src/lib/client-download";
import { storageClient, digest } from "../src/lib/storage";
import { MUA_PLATFORMS } from "../src/lib/muapack-contract";
import { encodeMuaJson } from "../src/lib/muapack-protocol";
import { muaFixture } from "./fixtures/muapack";

process.env.S3_ENDPOINT = "https://s3.test.invalid";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
process.env.S3_REGION = "us-east-1";
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;

function fixture(t: TestContext, format: 1 | 2, protocolRevision: 1 | 2 = 2) {
  const objects = new Map<string, { bytes: Buffer; sha256: string; size: number; etag: string }>();
  const put = (key: string, bytes: Buffer) => {
    const value = { bytes, sha256: digest(bytes), size: bytes.length, etag: '"opaque-multipart-etag-3"' };
    objects.set(key, value); return value;
  };
  const manifests = format === 1 ? [muaFixture().manifest, muaFixture("1.1.0").manifest] : ["base-full", "target-full"].map(name => {
    const value = JSON.parse(readFileSync(`docs/examples/muapack-v2/${name}/metadata/target-manifest.json`, "utf8"));
    if (protocolRevision === 1) value.supportedPlatforms = [...MUA_PLATFORMS];
    else { delete value.supportedPlatforms; value.protocolRevision = 2; }
    return value;
  });
  const releases = manifests.map((manifest, index) => {
    const bytes = format === 2 ? encodeMuaJson(manifest) : Buffer.from(JSON.stringify({ schemaVersion: 2, clientId: manifest.release.clientId, organizationId: manifest.release.organizationId, version: manifest.release.version }));
    return { id: manifest.release.releaseId, sourceDraftId: manifest.release.releaseId, clientId: manifest.release.clientId, packageFormatVersion: format,
      versionLabel: manifest.release.version, archivedAt: null as Date | null, manifestObjectKey: `release-${index}`, manifestSha256: put(`release-${index}`, bytes).sha256 };
  });
  const builds = manifests.map((manifest, index) => {
    const targetKey = format === 2 ? `release-${index}` : `target-${index}`;
    const target = put(targetKey, encodeMuaJson(manifest));
    const full = put(`full-${index}`, Buffer.from(`full-package-${index}`));
    const delta = put(`update-${index}`, Buffer.from(`update-package-${index}`));
    return { draftId: releases[index].id, platform: format === 2 ? "universal" : "windows-amd64", revision: 1, required: true, status: "READY",
      targetObjectKey: targetKey, targetSha256: target.sha256,
      artifacts: { full: { key: `full-${index}`, sha256: full.sha256, size: full.size }, update: index === 0 ? null : {
        key: `update-${index}`, sha256: delta.sha256, size: delta.size, baseReleaseId: releases[0].id,
        baseManifestSha256: format === 2 ? releases[0].manifestSha256 : digest(encodeMuaJson(manifests[0])),
      }, signingKeyId: "a".repeat(24) } };
  });
  let current = releases[1]; let visible = true; let uploadBase = releases[0].id;
  const db = {
    server: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.deepEqual(where.publication, { client: { archivedAt: null, deletedAt: null }, release: { archivedAt: null } });
      assert.equal(where.isListed, true); assert.equal(where.archivedAt, null); assert.deepEqual(where.organization, { archivedAt: null });
      return visible ? { organizationId: manifests[0].release.organizationId, publication: { release: current } } : null;
    } },
    clientRelease: { findUnique: async ({ where }: { where: { id: string } }) => releases.find(release => release.id === where.id) ?? null },
    clientDraft: { findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ id: where.id, packageRevision: 1 }) },
    clientUpload: { findUnique: async () => ({ baseReleaseId: uploadBase }) },
    packageBuild: { findUnique: async ({ where }: { where: { draftId_platform_revision: { draftId: string; platform: string } } }) => builds.find(build => build.draftId === where.draftId_platform_revision.draftId && build.platform === where.draftId_platform_revision.platform) ?? null },
  } as unknown as Db;
  t.mock.method(storageClient(), "send", async (command: GetObjectCommand | HeadObjectCommand) => {
    const value = objects.get(command.input.Key!);
    if (!value) throw { $metadata: { httpStatusCode: 404 } };
    if (command instanceof GetObjectCommand) return { Body: Readable.from([value.bytes]), ContentLength: value.size };
    assert(command instanceof HeadObjectCommand);
    return { ContentLength: value.size, Metadata: { sha256: value.sha256 }, ETag: value.etag };
  });
  const platform = format === 2 ? null : "windows-amd64";
  const request = (base: string | null = null, baseSha: string | null = null, releaseId: string | null = null, sha: string | null = null) => publicPackage(db, "NPU", platform, base, String(format), baseSha, releaseId, sha);
  return { db, objects, releases, builds, request, setVisible: (value: boolean) => { visible = value; }, setCurrent: (index: number) => { current = releases[index]; }, setUploadBase: (value: string) => { uploadBase = value; } };
}

for (const format of [1, 2] as const) {
  test(`v${format} fixed release uses S3 GET signing, exact object identity and bounded expiry`, async t => {
    const f = fixture(t, format), selected = await f.request();
    const query = new URL(selected.url).searchParams;
    assert.equal(query.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256"); assert.equal(query.get("X-Amz-Expires"), "300");
    assert(!query.get("X-Amz-SignedHeaders")?.includes("range"));
    const signedAt = query.get("X-Amz-Date")!;
    const date = new Date(`${signedAt.slice(0, 4)}-${signedAt.slice(4, 6)}-${signedAt.slice(6, 8)}T${signedAt.slice(9, 11)}:${signedAt.slice(11, 13)}:${signedAt.slice(13, 15)}Z`);
    assert.equal(Date.parse(selected.expiresAt) - date.getTime(), 300_000);
    assert.equal(selected.etag, '"opaque-multipart-etag-3"');
    assert(selected.refreshUrl.includes(`/releases/${selected.releaseId}/packages?`));
    assert.equal(new URL(selected.refreshUrl, "https://mua.invalid").searchParams.get("packageSha256"), selected.sha256);
    f.setCurrent(0);
    const renewed = await f.request(null, null, selected.releaseId, selected.sha256);
    assert.equal(renewed.releaseId, selected.releaseId); assert.equal(renewed.sha256, selected.sha256); assert.equal(renewed.size, selected.size);
    await assert.rejects(f.request(null, null, selected.releaseId, "f".repeat(64)), denied(409));
    await assert.rejects(f.request(null, null, "44444444-4444-4444-8444-444444444444"), denied(404));
    f.setVisible(false); await assert.rejects(f.request(null, null, selected.releaseId), denied(404));
  });

  test(`v${format} update pins baseline digest; wrong player digest falls back and refresh never swaps packages`, async t => {
    const f = fixture(t, format), baseSha = f.builds[1].artifacts.update!.baseManifestSha256;
    const update = await f.request(f.releases[0].id, baseSha);
    assert.equal(update.packageType, "update"); assert.equal(update.baseManifestSha256, baseSha);
    assert.equal((await f.request(f.releases[0].id, "0".repeat(64))).packageType, "full");
    f.releases[0].archivedAt = new Date();
    assert.equal((await f.request(f.releases[0].id)).packageType, "full");
    await assert.rejects(f.request(f.releases[0].id, baseSha, update.releaseId, update.sha256), denied(409));
  });

  for (const corruption of ["missing-full", "full-size", "full-hash", "missing-update", "update-size", "update-hash", "base-digest", "base-identity", "base-record-digest", "upload-origin", "target-digest", "target-identity"] as const) {
    test(`v${format} refuses corrupt distribution: ${corruption}`, async t => {
      const f = fixture(t, format), full = f.objects.get("full-1")!, update = f.objects.get("update-1")!;
      if (corruption === "missing-full") f.objects.delete("full-1");
      if (corruption === "full-size") full.size++;
      if (corruption === "full-hash") full.sha256 = "0".repeat(64);
      if (corruption === "missing-update") f.objects.delete("update-1");
      if (corruption === "update-size") update.size++;
      if (corruption === "update-hash") update.sha256 = "0".repeat(64);
      const key = (index: number) => f.builds[index].targetObjectKey;
      if (corruption === "base-digest") f.objects.get(key(0))!.bytes = Buffer.from("{}");
      if (corruption === "target-digest") f.objects.get(key(1))!.bytes = Buffer.from("{}");
      if (corruption === "base-record-digest") f.builds[1].artifacts.update!.baseManifestSha256 = "0".repeat(64);
      if (corruption === "upload-origin") f.setUploadBase(f.releases[1].id);
      if (corruption === "base-identity" || corruption === "target-identity") {
        const index = corruption === "base-identity" ? 0 : 1, object = f.objects.get(key(index))!;
        const document = JSON.parse(object.bytes.toString()); document.release.organizationId = "44444444-4444-4444-8444-444444444444";
        object.bytes = encodeMuaJson(document); object.sha256 = digest(object.bytes); object.size = object.bytes.length;
        f.builds[index].targetSha256 = object.sha256;
        if (format === 2) f.releases[index].manifestSha256 = object.sha256;
      }
      await assert.rejects(f.request(f.releases[0].id), denied(503));
    });
  }

  test(`v${format} validates only the selected package and full fallback when baseline does not match`, async t => {
    const f = fixture(t, format); f.objects.delete("update-1");
    assert.equal((await f.request()).packageType, "full");
    assert.equal((await f.request(f.releases[1].id)).packageType, "full");
    await assert.rejects(f.request(f.releases[0].id), denied(503));
  });

  test(`v${format} pinned historical releases cannot cross client identity or revive archived publication`, async t => {
    const f = fixture(t, format);
    const historical = await f.request(null, null, f.releases[0].id);
    assert.equal(historical.releaseId, f.releases[0].id);
    f.releases[0].clientId = "OTH";
    await assert.rejects(f.request(null, null, f.releases[0].id), denied(404));
    f.releases[0].clientId = f.releases[1].clientId;
    f.releases[0].archivedAt = new Date();
    await assert.rejects(f.request(null, null, f.releases[0].id), denied(404));
  });
}

test("download parameters fail before issuing a link for invalid UUIDs, digests or platform", async t => {
  const f = fixture(t, 2);
  await assert.rejects(f.request("not-a-uuid"), denied(400));
  await assert.rejects(f.request(null, "a".repeat(64)), denied(400));
  await assert.rejects(f.request(f.releases[0].id, "invalid-digest"), denied(400));
  await assert.rejects(f.request(null, null, "not-a-release"), denied(400));
  await assert.rejects(f.request(null, null, f.releases[1].id, "INVALID"), denied(400));
  await assert.rejects(publicPackage(fixture(t, 1).db, "NPU", "unsupported", null, "1"), denied(400));
});

test("legacy v1 missing baseline digest derives the immutable platform digest without editing artifacts", async t => {
  const f = fixture(t, 1), artifacts = f.builds[1].artifacts;
  delete (artifacts.update! as { baseManifestSha256?: string }).baseManifestSha256;
  const before = structuredClone(artifacts);
  const response = await f.request(f.releases[0].id);
  assert.equal(response.baseManifestSha256, f.builds[0].targetSha256); assert.equal(response.packageType, "update");
  assert.deepEqual(artifacts, before);
  await assert.rejects(publicPackage(f.db, "NPU", null, null), denied(400));
});

test("v2 negotiation is explicit and no platform is required; legacy restrictions stay readable", async t => {
  const f = fixture(t, 2, 1);
  await assert.rejects(publicPackage(f.db, "NPU", null, null), denied(415));
  const universal = await f.request(); assert("platform" in universal); assert.equal(universal.platform, "universal");
  for (const platform of MUA_PLATFORMS) assert.equal((await publicPackage(f.db, "NPU", platform, null, "2")).sha256, universal.sha256);
  const object = f.objects.get(f.releases[1].manifestObjectKey)!;
  const document = JSON.parse(object.bytes.toString()); document.supportedPlatforms = ["windows-amd64"];
  object.bytes = encodeMuaJson(document); object.sha256 = digest(object.bytes); object.size = object.bytes.length;
  f.releases[1].manifestSha256 = object.sha256; f.builds[1].targetSha256 = object.sha256;
  assert.equal((await f.request()).sha256, universal.sha256);
  await assert.rejects(publicPackage(f.db, "NPU", "linux-amd64", null, "2"), denied(404));
});

test("v2 revision 2 distributes the same full/update on any platform and omits platform fields from discovery and refresh", async t => {
  const f = fixture(t, 2), baseId = f.releases[0].id;
  const full = await f.request(), update = await f.request(baseId);
  assert("protocolRevision" in update); assert.equal(update.protocolRevision, 2);
  for (const response of [full, update]) {
    assert(!("platform" in response)); assert(!("supportedPlatforms" in response));
    assert(!new URL(response.refreshUrl, "https://mua.invalid").searchParams.has("platform"));
  }
  for (const platform of [null, "universal", ...MUA_PLATFORMS, "linux-riscv64", "freebsd-amd64"]) {
    const response = await publicPackage(f.db, "NPU", platform, baseId, "2");
    assert.equal(response.sha256, update.sha256); assert.equal(response.packageType, "update");
    assert(!("platform" in response));
  }
  // A legacy restricted baseline still identifies the same instance files; its bytes and digest stay intact.
  const object = f.objects.get(f.releases[0].manifestObjectKey)!;
  const baseline = JSON.parse(object.bytes.toString()); delete baseline.protocolRevision; baseline.supportedPlatforms = ["windows-amd64"];
  object.bytes = encodeMuaJson(baseline); object.sha256 = digest(object.bytes); object.size = object.bytes.length;
  f.releases[0].manifestSha256 = object.sha256; f.builds[0].targetSha256 = object.sha256;
  f.builds[1].artifacts.update!.baseManifestSha256 = object.sha256;
  for (const platform of [null, "linux-amd64", "linux-riscv64"]) {
    assert.equal((await publicPackage(f.db, "NPU", platform, baseId, "2", object.sha256)).packageType, "update");
  }
});
