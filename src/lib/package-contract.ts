import { z } from "zod";
import { selectedPlatformsSchema } from "./muapack-contract";
export const packageSelectionSchema = z.object({ platforms: selectedPlatformsSchema }).strict();
export const packageArtifactsSchema = z.object({ full: z.object({ key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }),
  update: z.object({ key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative(), baseReleaseId: z.string().uuid(),
    baseManifestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).nullable(),
  signingKeyId: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
export type PackageArtifacts = z.infer<typeof packageArtifactsSchema>;
export function packageBuildLabel(build: { status: string; phase: string; progress: number }) {
  if (build.status === "READY") return "已生成";
  if (build.status === "FAILED") return "生成失败";
  if (build.status === "PREPARED") return "清单已准备 · 等待审核签名";
  return `${build.phase} · ${build.progress}%`;
}
