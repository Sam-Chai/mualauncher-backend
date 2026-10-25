import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { translate } from "../../src/lib/i18n";
import { assertApiResponse } from "../openapi-validation";
import type { ExecutionSettings } from "../../src/lib/execution-management-contract";
test("execution settings use real worker state, disable unavailable Docker and show instances in both languages", async ({ page, baseURL }) => {
  expect((await page.request.get("/api/admin/execution-settings")).status()).toBe(401);
  let credentials = { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  if (!credentials.username || !credentials.password) {
    const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
    if (!file) throw new Error("Configure local smoke credentials");
    const source = await readFile(`.local/${file}`, "utf8"); credentials = { username: source.match(/^Username: (.+)$/m)?.[1], password: source.match(/^Password: (.+)$/m)?.[1] };
  }
  expect((await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: credentials })).status()).toBe(200);
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
