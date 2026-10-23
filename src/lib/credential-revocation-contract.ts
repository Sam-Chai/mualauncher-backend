import { z } from "zod";

export const credentialRevocationSchema = z.object({ ok: z.literal(true), sessions: z.number().int().nonnegative(),
  apiTokens: z.number().int().nonnegative(), launcherApprovals: z.number().int().nonnegative() }).strict();
