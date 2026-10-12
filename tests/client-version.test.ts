import assert from "node:assert/strict";
import { test } from "node:test";
import { compareClientVersions, orderClientVersions } from "../src/lib/client-version";
test("client versions compare numeric SemVer, prereleases and build metadata without unsafe integer rounding", () => {
  assert.equal(compareClientVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareClientVersions("v1.0.0", "1.0.0+build.2"), 0);
  assert.equal(compareClientVersions("1.0.0-rc.10", "1.0.0-rc.2"), 1);
  assert.equal(compareClientVersions("1.0.0-rc.10", "1.0.0"), -1);
  assert.equal(compareClientVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareClientVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  for (const label of ["01.0.0", "1.0", "1.0.0-01", "release-october"]) assert.equal(compareClientVersions(label, "1.0.0"), null);
});
test("mixed custom labels use internal submission order rather than an inconsistent semantic comparator", () => {
  const versions = [{ versionLabel: "1.9.0", versionSequence: 3 }, { versionLabel: "1.10.0", versionSequence: 1 }];
  assert.deepEqual(orderClientVersions(versions).map(v => v.versionLabel), ["1.10.0", "1.9.0"]);
  assert.deepEqual(orderClientVersions([...versions, { versionLabel: "autumn", versionSequence: 2 }]).map(v => v.versionLabel), ["1.9.0", "autumn", "1.10.0"]);
  assert.deepEqual(versions.map(v => v.versionSequence), [3, 1]);
});
