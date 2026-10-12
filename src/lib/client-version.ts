// Labels remain compatible with existing/custom version names. Only valid SemVer
// labels have semantic precedence; draft sequence supplies a stable fallback.
function semver(label: string) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(label);
  if (!match) return null;
  const pre = match[4]?.split(".") ?? [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return { core: match.slice(1, 4), pre };
}
function numberOrder(a: string, b: string) { return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1; }
export function compareClientVersions(a: string, b: string): number | null {
  const left = semver(a), right = semver(b); if (!left || !right) return null;
  for (let i = 0; i < 3; i++) { const order = numberOrder(left.core[i], right.core[i]); if (order) return order; }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i]; if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    return nx && ny ? numberOrder(x, y) : nx !== ny ? nx ? -1 : 1 : x < y ? -1 : 1;
  }
  return 0;
}
export function orderClientVersions<T extends { versionLabel: string | null; versionSequence: number }>(versions: readonly T[]): T[] {
  // Mixed custom labels must not create a non-transitive sorting comparator.
  const allSemantic = versions.every(version => version.versionLabel && semver(version.versionLabel));
  return [...versions].sort((a, b) => (allSemantic ? compareClientVersions(b.versionLabel!, a.versionLabel!)! : 0) || b.versionSequence - a.versionSequence);
}
