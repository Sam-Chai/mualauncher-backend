import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { z } from "zod";
import { invariant } from "./errors";
import { readObject, digest } from "./storage";
import { safePackPath } from "./pack-parser";
import type { FileInventory } from "./client-contract";
import { parseRecipeInventory } from "./recipe-inventory";
export async function readRecipeInventory(key: string, sha256: string) {
  const bytes = await readObject(key); invariant(bytes.length <= 16 * 1024 ** 2 && digest(bytes) === sha256, 422, diagnosticText("diagnostics.packInventory.theV2ImportIndexSizeOrDigestDoesNotMatch"));
  return parseRecipeInventory(JSON.parse(bytes.toString("utf8")));
}
export async function readInventory(key: string, sha256: string): Promise<FileInventory> {
  const bytes = await readObject(key); invariant(digest(bytes) === sha256, 422, diagnosticText("diagnostics.packInventory.theFileIndexDigestDoesNotMatch"));
  const inventory = z.object({ schemaVersion: z.literal(1), files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(), policy: z.enum(["managed", "preserve"]), optional: z.boolean().optional() }).strict()).min(1).max(100000) }).strict().safeParse(JSON.parse(bytes.toString("utf8")));
  invariant(inventory.success, 422, diagnosticText("diagnostics.packInventory.invalidFileIndexFormat")); inventory.data.files.forEach(file => safePackPath(file.path)); return inventory.data;
}
