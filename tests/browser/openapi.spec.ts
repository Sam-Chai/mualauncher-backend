import { test, expect } from "@playwright/test";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { assertApiResponse } from "../openapi-validation";
import { PUBLIC_OPERATION_IDS } from "../../src/lib/openapi/document";
import { apiInventory } from "../../src/lib/openapi/inventory";

const operationCount = (document: { paths: Record<string, object> }) => Object.values(document.paths).reduce((sum, path) => sum + ["get", "post", "patch", "put", "delete"].filter(method => method in path).length, 0);

test("dashboard plots real activity in both languages and keeps dark tooltips readable", async ({ page, baseURL }) => {
  const login = await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: await credentials() });
  expect(login.status()).toBe(200);
  await page.addInitScript(() => localStorage.setItem("mua-theme", "dark"));
  await page.context().addCookies([{ name: "mua-locale", value: "zh-CN", url: baseURL! }]);
  try {
    const response = await page.request.get("/api/admin/state");
    expect(response.status()).toBe(200);
    const { auditActivity } = await response.json() as { auditActivity: { date: string; count: number }[] };
    expect(auditActivity.length).toBeGreaterThan(1);
    await page.goto("/admin");
    for (const locale of ["zh-CN", "en-US"] as const) {
      await expect(page.getByRole("heading", { name: locale === "zh-CN" ? "控制台" : "Console", exact: true })).toBeVisible();
      const chart = page.locator('[data-slot="area-chart"]').first();
      await expect(chart.locator('.recharts-area-curve[d]')).toBeVisible();
      await expect(chart.locator('.recharts-area-curve[d]')).toHaveAttribute("name", locale === "zh-CN" ? "操作次数" : "Actions");
      await expect.poll(() => chart.locator('.recharts-area-curve[d]').evaluate(path => (path as SVGGraphicsElement).getBBox().height)).toBeGreaterThan(0);
      for (const tick of await chart.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').all()) {
        await expect(tick.locator('tspan')).toHaveCount(1);
      }
      const size = (await chart.boundingBox())!;
      await chart.hover({ position: { x: size.width * 0.55, y: 120 } });
      const tooltip = chart.locator('[data-slot="chart-tooltip"]');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(locale === "zh-CN" ? "操作次数" : "Actions");
      const day = await tooltip.locator("p").first().innerText();
      const point = auditActivity.find(point => point.date.slice(5) === day);
      expect(point).toBeDefined();
      await expect(tooltip).toContainText(locale === "zh-CN" ? `${point!.count} 次` : `${point!.count} actions`);
      await expect(tooltip).toHaveCSS("background-color", "rgb(32, 47, 64)");
      await expect(tooltip.locator("p").first()).toHaveCSS("color", "rgb(228, 221, 208)");
      await page.screenshot({ path: `.local/dark-theme-dashboard-${locale}.png`, caret: "initial" });
      if (locale === "zh-CN") {
        await page.getByRole("button", { name: "切换语言", exact: true }).click();
        await page.getByRole("menuitem", { name: /English/ }).click();
      }
    }
    const header = page.locator('[data-slot="admin-header"]');
    expect((await header.boundingBox())!.y).toBe(8);
    await expect(header).toHaveCSS("backdrop-filter", "blur(24px)");
    await expect(header).toHaveCSS("box-shadow", "none");
    const frame = page.locator('[data-slot="admin-content-panel"]');
    await expect(frame).toHaveCSS("border-top-right-radius", "14px");
    await expect(frame).toHaveCSS("border-bottom-right-radius", "14px");
    await expect(frame).toHaveCSS("overflow", "clip");
    const frameBounds = (await frame.boundingBox())!;
    expect(frameBounds.y - ((await header.boundingBox())!.y + (await header.boundingBox())!.height)).toBe(8);
    const scrollBounds = (await page.locator('[data-slot="admin-content"]').boundingBox())!;
    expect(frameBounds.x + frameBounds.width - scrollBounds.x - scrollBounds.width).toBe(4);
    expect(frameBounds.y + frameBounds.height - scrollBounds.y - scrollBounds.height).toBe(4);
    await page.locator('[data-slot="admin-content"]').hover({ position: { x: 250, y: 250 } });
    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.locator('[data-slot="admin-content"]').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect((await header.boundingBox())!.y).toBe(8);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: ".local/dark-theme-floating-header.png", caret: "initial" });
    await page.locator('a[href="/admin/organizations"]').first().click();
    await expect(page.getByRole("heading", { name: "Organization", exact: true })).toBeVisible();
    await expect.poll(() => page.locator('[data-slot="admin-content"]').evaluate(element => element.scrollTop)).toBe(0);
  } finally {
    await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} });
  }
});

async function credentials() {
  if (process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD) return { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
  if (!file) throw new Error("Set SMOKE_USERNAME and SMOKE_PASSWORD for an existing local test account.");
  const contents = await readFile(`.local/${file}`, "utf8");
  const username = contents.match(/^Username: (.+)$/m)?.[1], password = contents.match(/^Password: (.+)$/m)?.[1];
  if (!username || !password) throw new Error("Missing local smoke credentials.");
  return { username, password };
}

test("embedded Scalar protects sessions, follows preferences, downloads the spec and tests the public directory", async ({ page, baseURL }) => {
  const errors: string[] = [], external = new Set<string>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.add(new URL(request.url()).origin); });
  await mkdir(".local", { recursive: true });
  const privateAnonymous = await page.request.get("/api/admin/openapi");
  expect(privateAnonymous.status()).toBe(401);
  expect((await page.request.get("/api/admin/openapi", { headers: { Authorization: `Bearer mua_${"0".repeat(64)}` } })).status()).toBe(401);
  for (const locale of ["zh-CN", "en-US"]) {
    const response = await page.request.get(`/openapi.json?locale=${locale}`);
    expect(response.status()).toBe(200); expect(response.headers()["content-language"]).toBe(locale);
    expect(Object.keys((await response.json()).paths)).toHaveLength(PUBLIC_OPERATION_IDS.length);
  }
  await page.goto("/admin/api");
  await expect(page).toHaveURL(/\/login$/);
  const login = await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: await credentials() });
  expect(login.status()).toBe(200);
  const sessionCookie = (await page.context().cookies(baseURL!)).find(value => value.name === "mua_session");
  try {
    const internal = await page.request.get("/api/admin/openapi?locale=en-US"); expect(internal.status()).toBe(200);
    expect(internal.headers()["cache-control"]).toBe("private, no-store"); expect(operationCount(await internal.json())).toBe(apiInventory.length);
    const state = await page.request.get("/api/admin/state"); expect(state.status()).toBe(200); assertApiResponse("GET", "/api/admin/state", 200, await state.json());
    const telemetry = await page.request.get("/api/admin/storage-telemetry"); expect(telemetry.status()).toBe(200);
    expect(telemetry.headers()["cache-control"]).toBe("private, no-store");
    assertApiResponse("GET", "/api/admin/storage-telemetry", 200, await telemetry.json());
    await page.goto("/admin/api");
    await expect(page.getByRole("link", { name: "API", exact: true }).first()).toBeVisible();
    for (const href of ["/admin/news", "/admin/events", "/admin/launcher-ui", "/admin/listings", "/admin/servers/status", "/admin/releases/revoked"]) {
      await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "API 文档", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Union Link API", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("获取账号可访问服务器目录", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    const panel = page.locator('[data-slot="scalar-reference"]');
    const navigation = panel.locator(".t-doc__sidebar");
    const navigationBefore = (await navigation.boundingBox())!;
    const content = (await panel.locator(".references-rendered").boundingBox())!;
    await page.mouse.move(content.x + content.width / 2, Math.min(content.y + 180, 700));
    await page.mouse.wheel(0, 700);
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const navigationAfter = (await navigation.boundingBox())!;
    expect(Math.abs(navigationAfter.y - navigationBefore.y)).toBeLessThan(2);
    expect(navigationAfter.y + navigationAfter.height).toBeLessThanOrEqual((await panel.boundingBox())!.y + (await panel.boundingBox())!.height + 2);
    await page.screenshot({ path: ".local/api-documentation-scrolled.png", caret: "initial" });
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.mouse.wheel(0, 1000);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await panel.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: ".local/api-documentation-light.png", caret: "initial" });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载 OpenAPI JSON", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("union-link.zh-CN.openapi.json");
    expect(operationCount(JSON.parse(await readFile((await download.path())!, "utf8")))).toBe(apiInventory.length);
    await page.getByRole("button", { name: "切换黑白主题", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".dark-mode").first()).toBeVisible();
    await expect(page.locator('[data-slot="admin-header"]')).toHaveCSS("border-radius", "14px");
    await expect(page.locator('[data-slot="sidebar-inner"]')).toHaveCSS("border-radius", "14px");
    await page.screenshot({ path: ".local/api-documentation-dark.png" });
    await page.getByRole("button", { name: "切换语言", exact: true }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "API reference", exact: true })).toBeVisible();
    await expect(page.getByText("List servers accessible to the signed-in account", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Toggle light / dark theme", exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/api-documentation-english.png" });
    await page.getByRole("button", { name: /^Open Search/ }).click();
    const search = page.getByRole("dialog").getByRole("combobox", { name: "Enter search query" });
    await search.fill("fixed release", { timeout: 10_000 });
    await expect(page.getByRole("dialog").getByRole("option", { name: /Operation: Refresh download links for a fixed release/ })).toBeVisible();
    await search.fill("multipart");
    await expect(page.getByRole("dialog").getByRole("option", { name: /Operation: Upload or recrop/ })).toBeVisible();
    await page.getByRole("dialog").getByRole("option", { name: /Operation: Upload or recrop/ }).click();
    await page.getByRole("button", { name: /Test Request.*post.*motto-image/i }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Multipart Form", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Select File", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: "Include crop in request", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: "Include expectedIconObjectKey in request", exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/api-documentation-image-form.png" });
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden();
    // Both references have separate sources; private operations disappear from the public view.
    await page.getByRole("button", { name: "All management APIs", exact: true }).click();
    await page.getByRole("option", { name: "Launcher APIs", exact: true }).click();
    await expect(page.getByRole("button", { name: "Launcher APIs", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload or recrop the server motto image", exact: true })).toHaveCount(0);
    // Source changes can reopen the client. Close it before starting the explicit GET check.
    if (await page.getByRole("dialog").isVisible()) { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden(); }
    // Inspect the real UI before selecting the request control; the expected request is a read-only GET.
    await page.getByText("List servers accessible to the signed-in account", { exact: true }).first().click();
    const requestButton = page.getByRole("button", { name: /Test Request/i }).first();
    await expect(requestButton).toBeVisible(); await requestButton.click();
    await page.screenshot({ path: ".local/api-documentation-request.png" });
    const send = page.getByRole("button", { name: /^Send get request to /i });
    const [directory] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/servers" && response.request().method() === "GET", { timeout: 15_000 }),
      send.click(),
    ]);
    expect(directory.status()).toBe(200); expect(Array.isArray((await directory.json()).servers)).toBe(true);
    await page.screenshot({ path: ".local/api-documentation-response.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "API reference", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
    await page.screenshot({ path: ".local/api-documentation-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Launcher APIs", exact: true }).click();
    await page.getByRole("option", { name: "All management APIs", exact: true }).click();
    if (await page.getByRole("dialog").isVisible()) { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden(); }
    await page.getByRole("button", { name: /^Open Search/ }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Enter search query" }).fill("Sign out");
    await page.getByRole("dialog").getByRole("option", { name: /Operation: Sign out the current session/ }).click();
    await page.getByRole("button", { name: /Test Request.*post.*auth\/logout/i }).click();
    const [logout] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/logout" && response.request().method() === "POST"),
      page.getByRole("button", { name: /^Send post request to /i }).click(),
    ]);
    expect(logout.request().headers()["content-type"]).toBe("application/json");
    expect((await logout.request().allHeaders()).origin).toBe(new URL(baseURL!).origin);
    expect(logout.status()).toBe(200); assertApiResponse("POST", "/api/auth/logout", 200, await logout.json());
    expect((await page.request.get("/api/admin/state")).status()).toBe(401);
    expect(errors).toEqual([]); expect([...external]).toEqual([]);
  } finally {
    if (sessionCookie) await fetch(`${baseURL}/api/auth/logout`, { method: "POST", headers: { Origin: baseURL!, Cookie: `${sessionCookie.name}=${sessionCookie.value}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
  }
  expect((await page.request.get("/api/admin/openapi")).status()).toBe(401);
});
