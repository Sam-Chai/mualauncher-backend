import assert from "node:assert/strict";
import { test } from "node:test";
import { clientMetadataSchema, MAX_MODS } from "../src/lib/client-contract";

test("oversized mod collections are rejected before Zod accumulates per-element errors", () => {
  const result = clientMetadataSchema.safeParse({ versionLabel: "1.0.0", name: "Security fixture", minecraftVersion: "1.21.1",
    javaVersion: 21, summary: "Security fixture", description: "", mods: Array(MAX_MODS + 1).fill(0) });
  assert.equal(result.success, false);
  if (result.success) assert.fail("Oversized mod collection was accepted");
  assert.deepEqual(result.error.issues.map(issue => ({ code: issue.code, path: issue.path })), [{ code: "too_big", path: ["mods"] }]);
});
