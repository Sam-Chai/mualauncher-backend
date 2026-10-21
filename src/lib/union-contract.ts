import { z } from "zod";

export const unionSiteInput = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/), organizationId: z.string().uuid(),
  bsRoot: z.string().url().refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash; }),
  enabled: z.boolean(), revision: z.number().int().nonnegative() }).strict();
export const accessRequestInput = z.object({ sourceOrganizationId: z.string().uuid(), targetOrganizationId: z.string().uuid(), accountId: z.string().uuid(),
  serverIds: z.array(z.string().regex(/^[A-Za-z]{3,5}$/)).min(1).max(1000), autoIncludeNewServers: z.boolean(), reason: z.string().trim().min(1).max(1000) }).strict();
export const accessDecisionInput = z.object({ revision: z.number().int().positive(), decision: z.enum(["APPROVED", "REJECTED", "CANCELLED"]), note: z.string().trim().max(1000) }).strict();
export const accessRevokeInput = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
export const launcherStartInput = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const launcherClaimInput = z.object({ id: z.string().uuid(), verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/) }).strict();
export const unionUserInput = z.object({ sub: z.string().regex(/^[A-Z][A-Z0-9]{0,5}:[0-9]{1,20}$/), nickname: z.string().trim().min(1).max(100), email: z.string().max(320).optional() });

export type MemberServer = { serverId: string; displayName: string; description: string; gameAddress: string | null; themeColor: string | null;
  organization: { id: string; displayName: string }; currentRelease: { id: string; clientId: string; versionLabel: string; name: string; packageFormatVersion: number } };
