import { readFile } from "node:fs/promises";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue { return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {}; }
const methods = ["get", "post", "put", "patch", "delete"];
function canonical(value: unknown, root: ObjectValue, depth = 0): unknown {
  if (depth > 80) throw new Error("Schema nesting too deep");
  if (Array.isArray(value)) return value.map(child => canonical(child, root, depth + 1));
  if (!value || typeof value !== "object") return value;
  const record = object(value);
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
    const resolved = record.$ref.slice(2).split("/").reduce<unknown>((parent, key) => object(parent)[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
    if (!resolved) throw new Error(`Unresolved compatibility reference: ${record.$ref}`);
    return canonical(resolved, root, depth + 1);
  }
  return Object.fromEntries(Object.entries(record).filter(([key]) => !["description", "summary", "example", "examples", "title", "deprecated"].includes(key) && (!key.startsWith("x-") || ["x-permissions", "x-superadmin-only", "x-request-body-max-bytes"].includes(key))).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => {
    const normalized = canonical(child, root, depth + 1);
    // Repeating an anyOf alternative does not change its accepted values. Zod 4
    // removes redundant null branches; oneOf must retain duplicates because it
    // requires exactly one matching alternative.
    return [key, key === "anyOf" && Array.isArray(normalized)
      ? [...new Map(normalized.map(value => [JSON.stringify(value), value])).values()]
      : normalized];
  }));
}
export function compatibilityReport(before: unknown, after: unknown) {
  const base = object(before), target = object(after), oldPaths = object(base.paths), newPaths = object(target.paths);
  const removed: string[] = [], changed: string[] = [], added: string[] = [];
  for (const [path, value] of Object.entries(oldPaths)) for (const method of methods) {
    const previous = object(value)[method]; if (!previous) continue;
    const next = object(newPaths[path])[method];
    if (!next) { removed.push(`${method.toUpperCase()} ${path}`); continue; }
    const pick = (entry: unknown) => Object.fromEntries(Object.entries(object(entry)).filter(([key]) => ["parameters", "requestBody", "responses", "security", "x-permissions", "x-superadmin-only", "x-request-body-max-bytes"].includes(key)));
    if (JSON.stringify(canonical(pick(previous), base)) !== JSON.stringify(canonical(pick(next), target))) changed.push(`${method.toUpperCase()} ${path}`);
  }
  for (const [path, value] of Object.entries(newPaths)) for (const method of methods) if (object(value)[method] && !object(oldPaths[path])[method]) added.push(`${method.toUpperCase()} ${path}`);
  return { removed, changed, added, requiresReview: removed.length + changed.length > 0 };
}
export async function checkCompatibility(document: unknown, baselinePath: string) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")), report = compatibilityReport(baseline, document);
  if (report.requiresReview) throw new Error(`Compatibility review required against ${baselinePath}: ${JSON.stringify(report)}. Record the version change before updating its baseline.`);
  return report;
}
