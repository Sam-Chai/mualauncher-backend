import { test, expect, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { translate } from "../../src/lib/i18n";
import { assertApiResponse } from "../openapi-validation";
import type { ExecutionSettings } from "../../src/lib/execution-management-contract";
async function login(page: Page, baseURL: string) {
  let credentials = { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  if (!credentials.username || !credentials.password) {
    const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
    if (!file) throw new Error("Configure local smoke credentials");
    const source = await readFile(`.local/${file}`, "utf8"); credentials = { username: source.match(/^Username: (.+)$/m)?.[1], password: source.match(/^Password: (.+)$/m)?.[1] };
  }
  expect((await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: credentials })).status()).toBe(200);
}
test("execution settings use real worker state, disable unavailable Docker and show instances in both languages", async ({ page, baseURL }) => {
  expect((await page.request.get("/api/admin/execution-settings")).status()).toBe(401);
  await login(page, baseURL!);
  const response = await page.request.get("/api/admin/execution-settings"), settings = await response.json() as ExecutionSettings;
  expect(response.status()).toBe(200); assertApiResponse("GET", "/api/admin/execution-settings", 200, settings);
  for (const locale of ["zh-CN", "en-US"] as const) {
    await page.context().addCookies([{ name: "mua-locale", value: locale, url: baseURL! }]);
    await page.goto("/admin/system/settings");
    const title = translate(locale, "executionSettings.title"), card = page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
    await card.scrollIntoViewIfNeeded(); const select = page.getByLabel(translate(locale, "executionSettings.mode"), { exact: true });
    await expect(select).toHaveValue(settings.mode);
    expect(await select.locator('option[value="DOCKER_GVISOR"]').isDisabled()).toBe(!settings.dockerAvailable);
    if (!settings.dockerAvailable) await expect(card.getByText(translate(locale, "executionSettings.dockerUnavailable"))).toBeVisible();
    await card.screenshot({ path: `.local/execution-settings-${locale}.png` });
    if (settings.mode === "DOCKER_GVISOR" && settings.bareAvailable) {
      await select.selectOption("BARE"); await expect(card.getByRole("note")).toBeVisible();
      await expect(card.getByRole("button", { name: translate(locale, "executionSettings.save") })).toBeEnabled();
      // Inspect selection without changing the application's configured execution mode.
    }
    await page.goto("/admin/system/workers"); await expect(page.getByText(translate(locale, "executionSettings.instancesTitle"), { exact: true })).toBeVisible();
    const instances = await page.request.get("/api/admin/execution-instances"); expect(instances.status()).toBe(200);
    assertApiResponse("GET", "/api/admin/execution-instances", 200, await instances.json());
  }
  await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} });
});

test("settings keep navigation visible during focus and route changes with responsive sandbox panels", async ({ page, baseURL }) => {
  await login(page, baseURL!);
  for (const locale of ["zh-CN", "en-US"] as const) {
    await page.context().addCookies([{ name: "mua-locale", value: locale, url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 1008 });
    await page.goto("/admin/system/settings");
    const header = page.locator('[data-slot="admin-header"]');
    const content = page.locator('[data-slot="admin-content"]');
    const installer = page.locator('[data-slot="card"]').filter({ has: page.getByText(translate(locale, "executionSettings.title"), { exact: true }) });
    await expect(installer.locator("select")).toBeEnabled();
    const initialTop = (await header.boundingBox())!.y;
    async function expectHeaderInPlace() {
      await expect.poll(async () => (await header.boundingBox())!.y).toBe(initialTop);
      await expect(header.getByRole("button", { name: translate(locale, "shell.refreshData") })).toBeInViewport();
      expect(await page.locator('[data-slot="sidebar-wrapper"]').evaluate(el => el.scrollTop)).toBe(0);
      expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    }
    // Native focus/scrollIntoView also scroll overflow:hidden ancestors. Reproduce
    // the disappearing header by aligning a lower settings block to the top.
    await content.locator(":scope > *").last().evaluate(el => el.scrollIntoView({ block: "start" }));
    await expectHeaderInPlace();
    const sandbox = page.locator('[data-slot="card"]').filter({ has: page.getByText(translate(locale, "sandboxManagement.title"), { exact: true }) });
    await expect(sandbox.getByText(translate(locale, "sandboxManagement.notConnected"), { exact: true })).toBeVisible();
    expect(await sandbox.locator("button, input, select").count()).toBe(0);
    const left = (await installer.boundingBox())!, right = (await sandbox.boundingBox())!;
    expect(right.y).toBeCloseTo(left.y, 0); expect(right.width).toBeCloseTo(left.width, 0);
    expect(right.x).toBeGreaterThan(left.x + left.width);
    await installer.locator("select").focus(); await expectHeaderInPlace();
    await page.getByRole("button", { name: translate(locale, "preferences.theme.toggle") }).click();
    await expectHeaderInPlace();
    await installer.evaluate(el => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `.local/settings-sandbox-${locale}.png` });
    for (let i = 0; i < 2; i++) {
      await page.locator('a[href="/admin/system/workers"]').first().click();
      await page.waitForURL("**/admin/system/workers"); await expectHeaderInPlace();
      await page.locator('a[href="/admin/system/settings"]').first().click();
      await page.waitForURL("**/admin/system/settings"); await expectHeaderInPlace();
      await expect.poll(() => content.evaluate(el => el.scrollTop)).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectHeaderInPlace();
    const mobileLeft = (await installer.boundingBox())!, mobileRight = (await sandbox.boundingBox())!;
    expect(mobileRight.x).toBeCloseTo(mobileLeft.x, 0);
    expect(mobileRight.y).toBeGreaterThanOrEqual(mobileLeft.y + mobileLeft.height);
    await sandbox.evaluate(el => el.scrollIntoView({ block: "start" })); await expectHeaderInPlace();
    expect(await content.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.local/settings-sandbox-mobile-${locale}.png` });
  }
  await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} });
});
