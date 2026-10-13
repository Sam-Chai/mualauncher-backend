import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { getPrisma, disconnectDatabases, type DatabasePurpose } from "../src/lib/prisma";

after(disconnectDatabases);

test("Prisma pools survive ordinary reloads and are replaced when generated models change", async () => {
  const first = getPrisma("web");
  assert.equal(getPrisma("web"), first);
  const state = globalThis as unknown as { muaClientSchemas: Map<DatabasePurpose, string> };
  state.muaClientSchemas.set("web", "model before display fields");
  const replacement = getPrisma("web");
  assert.notEqual(replacement, first);
  assert.equal(getPrisma("web"), replacement);
  const [{ role }] = await replacement.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
  assert.equal(role, "mua_web");
  // An auth/public pool retains its own restricted identity after the same invalidation.
  for (const purpose of ["auth", "public"] as const) {
    const before = getPrisma(purpose);
    state.muaClientSchemas.delete(purpose);
    const after = getPrisma(purpose);
    assert.notEqual(after, before);
    const [{ role }] = await after.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    assert.equal(role, `mua_${purpose}`);
  }
});
