import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { publicOpenApi } from "../src/lib/openapi/document";
import { adminOpenApi } from "../src/lib/openapi/private-document";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat("binary", true); ajv.addFormat("password", true);
ajv.addSchema({ $id: "urn:union-link:openapi", components: publicOpenApi().components });
const privateDocument = adminOpenApi("en-US");
ajv.addSchema({ $id: "urn:union-link:admin", ...privateDocument });
export function assertPublicResponse(schema: string, value: unknown) {
  const validate = ajv.getSchema(`urn:union-link:openapi#/components/schemas/${schema}`);
  assert(validate, `Missing response schema: ${schema}`);
  assert(validate(value), `${schema}: ${JSON.stringify(validate.errors)}`);
}

const pointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
export function contractOperation(method: string, url: string) {
  const pathname = new URL(url, "https://example.invalid").pathname;
  // Static uploads paths precede the legacy clientId wildcard.
  const paths = Object.entries(privateDocument.paths ?? {}).sort(([a], [b]) => b.replace(/\{[^}]+\}/g, "").length - a.replace(/\{[^}]+\}/g, "").length);
  for (const [path, item] of paths) {
    const pattern = path.split("/").map(segment => segment.startsWith("{") ? "[^/]+" : segment).join("/");
    if (!new RegExp(`^${pattern}$`).test(pathname)) continue;
    const operation = item?.[method.toLowerCase() as "get"];
    if (operation) return { path, operation };
  }
  throw new Error(`Missing documented operation: ${method} ${pathname}`);
}
export function assertApiResponse(method: string, url: string, status: number, value: unknown) {
  const { path, operation } = contractOperation(method, url);
  const response = operation.responses?.[String(status)];
  assert(response && "content" in response && response.content?.["application/json"], `Undocumented JSON response: ${method} ${path} ${status}`);
  const validate = ajv.getSchema(`urn:union-link:admin#/paths/${pointer(path)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema`);
  assert(validate, `Missing response validator: ${method} ${path} ${status}`);
  assert(validate(value), `${method} ${path} ${status}: ${JSON.stringify(validate.errors)}`);
}
export function assertApiRequest(method: string, url: string, value: unknown) {
  const { path, operation } = contractOperation(method, url);
  assert(operation.requestBody && "content" in operation.requestBody && operation.requestBody.content["application/json"], `Missing JSON request: ${method} ${path}`);
  const validate = ajv.getSchema(`urn:union-link:admin#/paths/${pointer(path)}/${method.toLowerCase()}/requestBody/content/application~1json/schema`);
  assert(validate, `Missing request validator: ${method} ${path}`);
  assert(validate(value), `${method} ${path} request: ${JSON.stringify(validate.errors)}`);
}
