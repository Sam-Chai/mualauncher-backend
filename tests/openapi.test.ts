import { fixtureClientId } from "./fixtures/identity";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validate } from "@scalar/openapi-parser";
import { publicOpenApi, PUBLIC_OPERATION_IDS } from "../src/lib/openapi/document";
import { apiInventory } from "../src/lib/openapi/inventory";
import { assertApiRequest, assertApiResponse, assertPublicResponse } from "./openapi-validation";
import { adminOpenApi, privateOperations } from "../src/lib/openapi/private-document";
import { sourceOperations, verifyCoverage } from "../scripts/openapi-coverage";
import { compatibilityReport } from "../scripts/openapi-compatibility";
import { requestContractSource } from "../scripts/openapi-sources";
import { readFile } from "node:fs/promises";
import { visiblePaths } from "../src/components/admin/navigation-access";
import { currentNavigation } from "../src/components/admin/navigation";
import { GET as publicDocument } from "../src/app/openapi.json/route";
import translations from "../src/lib/locales/openapi-en.json";

test("both locale documents are valid OpenAPI 3.1 with exactly four public operations", async () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const document = publicOpenApi(locale), result = await validate(JSON.stringify(document));
    assert(result.valid, JSON.stringify(result.errors));
    assert.equal(document.info.title, "Union Link API"); assert.equal(document.openapi, "3.1.0");
    assert(document.paths);
    assert.deepEqual(document.servers?.map(server => server.url), ["/"]);
    const ids = Object.entries(document.paths).map(([path, item]) => {
      assert(path.startsWith("/api/v1/servers")); assert(item?.get); assert.deepEqual(item.get.security, []); return item.get.operationId;
    });
    assert.deepEqual(ids.sort(), [...PUBLIC_OPERATION_IDS].sort());
    assert(!JSON.stringify(document).includes("/api/admin/"));
    if (locale === "en-US") assert(!/[\u3400-\u9fff]/.test(JSON.stringify(document)));
  }
  // Translation can change prose, never schemas, parameter names or paths.
  const shape = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(shape);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["description", "summary"].includes(key)).map(([key, child]) => [key, shape(child)]));
    return value;
  };
  assert.deepEqual(shape(publicOpenApi("zh-CN")), shape(publicOpenApi("en-US")));
});

test("all operations are documented while only Launcher operations are public; ordinary members see the API menu", () => {
  assert.equal(new Set(apiInventory.map(item => `${item.method} ${item.path}`)).size, apiInventory.length);
  assert.equal(apiInventory.filter(item => item.documented).length, 63);
  const described = Object.entries(publicOpenApi().paths ?? {}).map(([path]) => `GET ${path}`).sort();
  assert.deepEqual(described, apiInventory.filter(item => item.group === "Launcher").map(item => `${item.method} ${item.path}`).sort());
  assert(apiInventory.some(item => item.path === "/api/v1/clients/uploads/{uploadId}/submit"));
  assert(apiInventory.some(item => item.method === "DELETE" && item.path.endsWith("/motto-image")));
  assert(visiblePaths({ actor: { id: "member", displayName: "Member", isSuperAdmin: false }, organizations: [] }).has("/admin/api"));
  assert.equal(currentNavigation("/admin/api").title, "API");
  for (const [source, target] of Object.entries(translations)) {
    assert(target); assert(!/[\u3400-\u9fff]/.test(target), source);
    assert.deepEqual(target.match(/\{\d+\}/g) ?? [], source.match(/\{\d+\}/g) ?? []);
  }
});

test("full documents validate in both languages and document session/Bearer boundaries and binary uploads", async () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const document = adminOpenApi(locale), parsed = await validate(JSON.stringify(document));
    assert(parsed.valid, JSON.stringify(parsed.errors));
    const ids: string[] = [];
    for (const [path, item] of Object.entries(document.paths!)) for (const method of ["get", "post", "patch", "put", "delete"] as const) {
      const operation = item?.[method]; if (!operation) continue;
      ids.push(operation.operationId!);
      if (path.startsWith("/api/v1/clients")) assert.deepEqual(operation.security, [{ SessionCookie: [] }, { ApiToken: [] }]);
      if (path.startsWith("/api/admin")) assert.deepEqual(operation.security, [{ SessionCookie: [] }]);
    }
    assert.equal(ids.length, 63); assert.equal(new Set(ids).size, 63);
    if (locale === "en-US") assert(!/[\u3400-\u9fff]/.test(JSON.stringify(document)));
    const settings = document.paths!["/api/admin/upload-size-settings"]!;
    assert.equal(settings.get?.["x-superadmin-only"], true); assert.equal(settings.patch?.["x-superadmin-only"], true);
    const image = document.paths!["/api/admin/servers/{serverId}/motto-image"]!;
    const upload = image.post?.requestBody; assert(upload && "content" in upload);
    assert(upload.content["multipart/form-data"]);
    const response = image.get?.responses?.[200]; assert(response && "content" in response);
    assert(response.content?.["image/webp"]); assert(response.content?.["application/json"]);
    assert.deepEqual(document.paths!["/api/auth/login"]?.post?.security, []);
    assert.deepEqual(document.paths!["/api/auth/password"]?.post?.security, [{ SessionCookie: [] }]);
  }
});

test("coverage reads actual catch-all branches, expands alternatives and detects missing operations", async () => {
  assert.equal(await verifyCoverage([...apiInventory.filter(item => item.group === "Launcher"), ...privateOperations]), 63);
  await assert.rejects(verifyCoverage(apiInventory.slice(1)), /coverage mismatch/);
  await assert.rejects(verifyCoverage([...apiInventory, { method: "GET", path: "/api/not-real" }]), /coverage mismatch/);
  const source = `const handler = (request, path) => { const [kind, id, action] = path;
    if (request.method === "POST" && kind === "uploads" && path.length === 3 && ["retry", "cancel"].includes(action)) return service(id);
    if (request.method === "PATCH" && kind === "new" && path.length === 1) return service(); };
    export const POST = handler; export const PATCH = handler;`;
  assert.deepEqual([...sourceOperations("src/app/api/v1/clients/[...path]/route.ts", source)].sort(), [
    "PATCH /api/v1/clients/new", "POST /api/v1/clients/uploads/{}/cancel", "POST /api/v1/clients/uploads/{}/retry",
  ]);
  assert.throws(() => sourceOperations("src/app/api/v1/clients/[...path]/route.ts", source.replace('kind === "new"', 'kind === variable')), /nonliteral routing/);
});

test("request validators are copied from services and changes cannot silently reuse old generated contracts", async () => {
  const generated = await requestContractSource();
  assert.equal((await readFile("src/lib/openapi/requests.generated.ts", "utf8")).replace(/\r\n/g, "\n"), generated);
  const source = await readFile("src/lib/client-service.ts", "utf8");
  const changed = source.replace("partNumber: z.number().int().min(1)", "partNumber: z.number().int().min(2)");
  assert.notEqual(changed, source);
  assert.notEqual(await requestContractSource({ "src/lib/client-service.ts": changed }), generated);
});

test("compatibility checks flag removed routes, auth changes and required fields, but allow descriptions/additions", () => {
  const baseline = adminOpenApi("en-US"), changed = structuredClone(baseline);
  changed.paths!["/api/v1/clients"]!.get!.security = [];
  assert(compatibilityReport(baseline, changed).changed.includes("GET /api/v1/clients"));
  const permissions = structuredClone(baseline); permissions.paths!["/api/admin/state"]!.get!["x-superadmin-only"] = true;
  assert(compatibilityReport(baseline, permissions).changed.includes("GET /api/admin/state"));
  delete changed.paths!["/api/v1/clients"]!.post;
  assert(compatibilityReport(baseline, changed).removed.includes("POST /api/v1/clients"));
  const prose = structuredClone(baseline); prose.paths!["/api/v1/clients"]!.get!.description = "Changed description";
  assert.equal(compatibilityReport(baseline, prose).requiresReview, false);
  const request = structuredClone(baseline);
  const body = request.paths!["/api/v1/clients"]!.post!.requestBody!;
  assert("content" in body);
  const schema = body.content["application/json"].schema as { required: string[] };
  schema.required.push("newRequiredField");
  assert(compatibilityReport(baseline, request).changed.includes("POST /api/v1/clients"));
  const added = structuredClone(baseline); added.paths!["/api/example"] = { get: structuredClone(baseline.paths!["/api/v1/clients"]!.get) };
  assert.deepEqual(compatibilityReport(baseline, added).added, ["GET /api/example"]);
  assert.equal(compatibilityReport(baseline, added).requiresReview, false);
});

test("key wire contracts reject request/response drift, revision types, missing fields and invalid statuses", () => {
  const id = "f70c7f37-29aa-4e3e-97d6-bc6d54da77c7";
  assertApiRequest("POST", "/api/v1/clients", { organizationId: id, name: "Example" });
  assert.throws(() => assertApiRequest("POST", "/api/v1/clients", { organizationId: id }));
  assertApiResponse("POST", "/api/v1/clients", 201, { clientId: fixtureClientId(id), name: "Example", currentReleaseId: null, publicationRevision: 0 });
  assert.throws(() => assertApiResponse("POST", "/api/v1/clients", 201, { clientId: fixtureClientId(id), name: "Example", publicationRevision: "0" }));
  assert.throws(() => assertApiResponse("POST", "/api/v1/clients", 204, {}));
  assert.throws(() => assertApiRequest("POST", `/api/v1/clients/ABC/drafts/${id}/review`, { decision: "maybe", note: "", contentRevision: 1 }));
  assert.throws(() => assertApiRequest("POST", `/api/v1/clients/ABC/drafts/${id}/archive`, { contentRevision: "1", packageRevision: 1 }));
  const upload = { clientId: id, fileName: "source.zip", size: 100, baseReleaseId: null, basePublicationRevision: 0 };
  assert.throws(() => assertApiRequest("POST", "/api/v1/clients/uploads", upload));
  assertApiRequest("POST", "/api/v1/clients/uploads", { ...upload, packageFormatVersion: 1 });
  assert.throws(() => assertApiRequest("POST", "/api/v1/clients/uploads", { ...upload, clientId: "NPU", packageFormatVersion: 1 }));
  assert.throws(() => assertApiRequest("POST", `/api/v1/clients/${id}/drafts/${id}/review`, { decision: "approve", note: "", contentRevision: 1 }));
  assert.throws(() => assertApiRequest("POST", `/api/v1/clients/${id}/drafts/${id}/publish`, { activate: true }));
  const metadata = { versionLabel: "1.0.0", name: "Example", summary: "Release", description: "" };
  assert.throws(() => assertApiRequest("POST", `/api/v1/clients/uploads/${id}/submit`, { ...metadata, mods: [] }));
  assert.throws(() => assertApiRequest("PATCH", "/api/admin/servers/NPU", { iconObjectKey: "arbitrary-key" }));
});

test("public JSON endpoint follows explicit locale and exposes no private routes", async () => {
  for (const [requested, locale] of [["zh-CN", "zh-CN"], ["en-US", "en-US"], ["bad", "zh-CN"]]) {
    const response = publicDocument(new Request(`https://example.invalid/openapi.json?locale=${requested}`));
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-language"), locale);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(publicOpenApi(locale as "zh-CN" | "en-US"))));
  }
});

test("wire response contracts accept empty directories and reject malformed file/error payloads", () => {
  assertPublicResponse("ServerDirectory", { servers: [] });
  assertPublicResponse("Error", { error: "unavailable" });
  assert.throws(() => assertPublicResponse("Error", { message: "wrong field" }));
});
