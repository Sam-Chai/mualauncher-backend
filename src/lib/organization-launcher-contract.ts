import { z } from "zod";
export const skinSiteAuthorizationsInput = z.array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/),
  url: z.string().url().max(2048), enabled: z.boolean() }).strict()).min(1).max(1000)
  .refine(rows => new Set(rows.map(row => `${row.code}:${row.url}`)).size === rows.length, "Duplicate skin-site authorization");
