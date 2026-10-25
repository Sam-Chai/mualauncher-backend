import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { translate } from "../../src/lib/i18n";
import type { UploadView } from "../../src/lib/client-contract";

for (const locale of ["zh-CN", "en-US"] as const) test(`upload mod pagination survives polling and clamps shrinking lists (${locale})`, async ({ page, baseURL }) => {
  let credentials = { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  if (!credentials.username || !credentials.password) {
    const name = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
    if (!name) throw new Error("Configure local smoke credentials");
    const source = await readFile(`.local/${name}`, "utf8");
    credentials = { username: source.match(/^Username: (.+)$/m)?.[1], password: source.match(/^Password: (.+)$/m)?.[1] };
  }
  expect((await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: credentials })).status()).toBe(200);
  await page.context().addCookies([{ name: "mua-locale", value: locale, url: baseURL! }]);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let count = 35, polls = 0;
  let selectedInstanceId: string | null = null;
  const upload = (): UploadView => ({ id: "00000000-0000-4000-8000-000000000011", clientId: "00000000-0000-4000-8000-000000000012",
    fileName: "pagination.zip", size: 100, partSize: 100, packageFormatVersion: 1, status: "PROCESSING", progress: Math.min(90, ++polls),
    error: null, draftId: null, statistics: null, detectedMods: Array.from({ length: count }, (_, i) => `mod-${String(i + 1).padStart(2, "0")}.jar`),
    warnings: [], processingPhase: "CAS", detectedInfo: null, selectedInstanceId, baseReleaseId: null, basePublicationRevision: 0, createdAt: "2026-10-25T00:00:00.000Z" });
  await page.route("**/api/v1/clients", route => route.fulfill({ json: [{ clientId: "00000000-0000-4000-8000-000000000012", name: "Pagination fixture", organizationId: "fixture", organizationName: "Fixture", serverId: null, serverName: "",
    requestedServerId: null, scopeServerId: null, archived: false, blocked: false, displaySchedule: null, lifecycleStatus: "UNPUBLISHED", permissions: ["DRAFT_READ", "DRAFT_CREATE", "DRAFT_SUBMIT"],
    publicationRevision: 0, currentReleaseId: null, initialPackageFormatVersion: 1, bindingRevision: null, drafts: [], releases: [], canDelete: false, uploads: [{ ...upload(), canEdit: true }] }] }));
  await page.route("**/api/v1/clients/uploads/00000000-0000-4000-8000-000000000011", route => route.fulfill({ json: upload() }));
  const t = (key: string) => translate(locale, key);
  try {
    await page.goto("/admin/clients");
    await page.getByRole("button", { name: t("clientUpload.continueEditing"), exact: true }).click();
    const dialog = page.getByRole("dialog"), next = dialog.getByRole("button", { name: t("dataTable.nextPage"), exact: true });
    const summary = (pageNumber: number, pages: number) => dialog.getByText(translate(locale, "dataTable.pageSummary", { page: pageNumber, pages }), { exact: true });
    await next.click(); await next.click();
    await expect(summary(3, 4)).toBeVisible();
    const beforePoll = polls;
    await expect.poll(() => polls).toBeGreaterThan(beforePoll + 2);
    await expect(summary(3, 4)).toBeVisible();
    await expect(dialog.getByText("mod-21.jar", { exact: true })).toBeVisible();
    await next.click(); count = 15;
    await expect(summary(2, 2)).toBeVisible();
    await expect(dialog.getByText("mod-11.jar", { exact: true })).toBeVisible();
    const search = dialog.getByRole("textbox", { name: t("clientShared.searchModFilesOrPaths"), exact: true });
    await search.fill("mod-01"); await expect(summary(1, 1)).toBeVisible();
    await expect(dialog.getByText("mod-01.jar", { exact: true })).toBeVisible();
    await search.clear(); count = 35;
    await expect(summary(1, 4)).toBeVisible();
    await next.click();
    await dialog.getByRole("button", { name: translate(locale, "dataTable.sortColumn", { column: t("clientShared.modFile") }), exact: true }).click();
    await expect(summary(1, 4)).toBeVisible();
    await next.click(); selectedInstanceId = "versions/another-instance";
    await expect(summary(1, 4)).toBeVisible();
    count = 0; await expect(summary(1, 1)).toBeVisible(); await expect(next).toBeDisabled();
    await expect(dialog.getByRole("table")).not.toContainText("mod-01.jar");
    expect(errors).toEqual([]);
  } finally { await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} }); }
});
