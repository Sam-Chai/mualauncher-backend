import { formatMessage, type DisplayMessage } from "@/lib/diagnostics";
import { translator, type Translate } from "./i18n";
import { z } from "zod";
import { selectedPlatformsSchema } from "./muapack-contract";
export const packageSelectionSchema = z.object({ platforms: selectedPlatformsSchema }).strict();
export const packageArtifactsSchema = z.object({ full: z.object({ key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }),
  update: z.object({ key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative(), baseReleaseId: z.string().uuid(),
    baseManifestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).nullable(),
  signingKeyId: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
export type PackageArtifacts = z.infer<typeof packageArtifactsSchema>;
export function packageBuildLabel(build: { status: string; phase: DisplayMessage; progress: number }, t: Translate = translator("zh-CN")) {
  if (build.status === "READY") return t("diagnostics.packageContract.generated");
  if (build.status === "FAILED") return t("diagnostics.packageContract.generationFailed");
  if (build.status === "PREPARED") return t("diagnostics.packageContract.manifestPreparedAwaitingReviewAndSignature");
  return `${formatMessage(t, build.phase)} · ${build.progress}%`;
}
