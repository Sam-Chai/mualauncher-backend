import { createHash } from "node:crypto";

/** Stable UUIDs keep synthetic client identities distinct from MUA server IDs. */
export function fixtureClientId<T>(value: T): T {
  if (typeof value !== "string" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  const hex = createHash("sha256").update("union-link-test-client:" + value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as T;
}
