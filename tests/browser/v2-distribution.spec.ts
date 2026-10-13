import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { recipeDistribution } from "../../src/lib/recipe-distribution-contract";
import type { RecipeFile } from "../../src/lib/recipe-inventory";

test("v2 history shows actual package sizes, unknown environment and bilingual file changes", async ({ page, baseURL }) => {
  let credentials = { username: process.env.SMOKE_USERNAME!, password: process.env.SMOKE_PASSWORD! };
  if (!credentials.username || !credentials.password) {
    const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
    if (!file) throw new Error("Set smoke credentials for an existing test account");
    const contents = await readFile(`.local/${file}`, "utf8");
    credentials = { username: contents.match(/^Username: (.+)$/m)![1], password: contents.match(/^Password: (.+)$/m)![1] };
  }
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  expect((await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: credentials })).status()).toBe(200);
  const cookie = (await page.context().cookies(baseURL!)).find(value => value.name === "mua_session");
  try {
    const local: RecipeFile = { path: "config/game.txt", size: 4096, policy: "preserve", optional: false, executable: false, hashes: { sha256: "1".repeat(64) }, source: { type: "local", entry: "overrides/config/game.txt" } };
    const remote: RecipeFile = { path: "mods/new.jar", size: 8192, policy: "managed", optional: true, executable: false, hashes: { sha1: "2".repeat(40), sha512: "2".repeat(128) }, source: { type: "remote", downloads: ["https://example.invalid/new.jar"] } };
    const stats = recipeDistribution([local, remote], { files: [], reference: { releaseId: "00000000-0000-4000-8000-000000000001", version: "1.0.0", manifestSha256: "3".repeat(64) } }, { full: 16384, update: 6144 });
    const metadata = { name: "Cinema v2", versionLabel: "1.1.0", minecraftVersion: "1.21.1", javaVersion: 21, mods: [], summary: "Browser fixture", description: "Read-only test" };
    const draft = { id: "00000000-0000-4000-8000-000000000002", packageFormatVersion: 2, supportedPlatforms: [], ...metadata, versionSequence: 2,
      replacesDraftId: null, archiveReason: null, supersededByDraftId: null, candidateMetadata: metadata, reviewNote: null, status: "APPROVED", contentRevision: 1, packageRevision: 1,
      archivedAt: null, createdAt: new Date().toISOString(), upload: null, packageBuilds: [] };
    await page.route("**/api/v1/clients", route => route.fulfill({ json: [{ clientId: "fixture", name: "Cinema v2", organizationId: "fixture", organizationName: "Cinema", serverId: null, serverName: "未绑定",
      requestedServerId: null, scopeServerId: null, archived: false, blocked: false, displaySchedule: null, lifecycleStatus: "UNPUBLISHED", permissions: ["SERVER_READ", "DRAFT_READ", "RELEASE_READ"],
      publicationRevision: 0, currentReleaseId: null, initialPackageFormatVersion: 2, bindingRevision: null, drafts: [draft], releases: [], canDelete: false, uploads: [] }] }));
    await page.route("**/distribution-statistics", route => route.fulfill({ json: stats }));
    await page.goto("/admin/clients");
    await expect(page.getByText("Cinema v2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "记录", exact: true }).click();
    await page.locator("summary").filter({ hasText: "1.1.0" }).click();
    const panel = page.locator("[data-v2-distribution]");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("14.00 KB", { exact: true })).toBeVisible();
    await expect(panel.getByText("待 Launcher 解析", { exact: true })).toBeVisible();
    await panel.locator("summary").click();
    await expect(panel.getByText("config/game.txt", { exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/v2-statistics-chinese.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "切换语言", exact: true }).click(); await page.getByRole("menuitem", { name: "English" }).click();
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page.locator("summary").filter({ hasText: "1.1.0" }).click();
    await expect(panel.getByText("Pending Launcher resolution", { exact: true })).toBeVisible();
    await expect(panel.getByText("Known network bytes (package + remote)", { exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/v2-statistics-english.png" });
    expect(errors).toEqual([]);
  } finally {
    if (cookie) await fetch(`${baseURL}/api/auth/logout`, { method: "POST", headers: { Origin: baseURL!, Cookie: `${cookie.name}=${cookie.value}`, "Content-Type": "application/json" }, body: "{}" });
  }
});
