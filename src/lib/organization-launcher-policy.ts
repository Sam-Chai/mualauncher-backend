// Consent follows CODE + registered root, not a shared ALI destination.
export function organizationLauncherAllowed(organization: { launcherLoginEnabled: boolean; launcherLoginOverrides?: unknown }, code: string, root: string) {
  const overrides = organization.launcherLoginOverrides;
  const value = overrides && typeof overrides === "object" && !Array.isArray(overrides)
    ? (overrides as Record<string, unknown>)[`${code}:${root}`] : undefined;
  return typeof value === "boolean" ? value : organization.launcherLoginEnabled;
}
