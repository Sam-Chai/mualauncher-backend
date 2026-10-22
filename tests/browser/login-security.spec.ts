import { test, expect, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";

const dummyPassword = "DUMMY-NOT-A-REAL-PASSWORD";
const hydrationErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  hydrationErrors.set(page, errors);
  page.on("console", message => { if (/hydrat|server rendered HTML/i.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", error => { if (/hydrat|server rendered HTML/i.test(error.message)) errors.push(error.message); });
});
test.afterEach(({ page }) => { expect(hydrationErrors.get(page)).toEqual([]); });
async function credentials() {
  if (process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD) return { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
  if (!file) throw new Error("Set SMOKE_USERNAME and SMOKE_PASSWORD for an existing local test account.");
  const contents = await readFile(`.local/${file}`, "utf8");
  const username = contents.match(/^Username: (.+)$/m)?.[1], password = contents.match(/^Password: (.+)$/m)?.[1];
  if (!username || !password) throw new Error("Missing local smoke credentials.");
  return { username, password };
}

test("password disclosure cannot change the server markup before hydration", async ({ page }) => {
  let release!: () => void;
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, async route => { await scripts; await route.continue(); });
  try {
    await page.goto("/login", { waitUntil: "commit" });
    const toggle = page.getByRole("button", { name: "使用账号密码登录", exact: true });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeDisabled();
    await toggle.evaluate(button => (button as HTMLButtonElement).click());
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('input[name="username"]')).toBeHidden();
    release();
    await expect(toggle).toBeEnabled();
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('input[name="username"]')).toBeHidden();
  } finally { release(); }
});

test("saved dark theme hydrates consistently on login and admin pages and keeps its pressed state", async ({ page, baseURL }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("mua-theme")) localStorage.setItem("mua-theme", "dark"); });
  await page.goto("/login");
  const toggle = page.getByRole("button", { name: "切换黑白主题", exact: true });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  try {
    const login = await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: await credentials() });
    expect(login.status()).toBe(200);
    await page.goto("/admin/organizations");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toBeEnabled();
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toBeEnabled();
    await expect(page.locator("html")).toHaveClass(/dark/);
  } finally { await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} }); }
});

test("credentials and submit stay disabled when JavaScript is unavailable", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/login`);
    await expect(page.locator('input[name="username"]')).toBeHidden();
    await expect(page.getByRole("button", { name: "使用账号密码登录", exact: true, includeHidden: true })).toBeDisabled();
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.locator("form")).toHaveAttribute("action", "/api/auth/login");
    await expect(page.locator('input[name="username"]')).toBeDisabled();
    await expect(page.locator('input[name="password"]')).toBeDisabled();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    expect(new URL(page.url()).search).toBe("");
  } finally { await context.close(); }
});

test("native submission sends credentials in the POST body and never in the URL", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[name="username"]')).toBeHidden();
  await page.getByRole("button", { name: "使用账号密码登录", exact: true }).click();
  await page.locator('input[name="username"]').fill("url-leak-probe");
  await page.locator('input[name="password"]').fill(dummyPassword);
  const navigation = page.waitForRequest(request => request.isNavigationRequest() && request.method() === "POST");
  // Bypass the React handler to exercise the browser's native fallback explicitly.
  await page.locator("form").evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const request = await navigation;
  expect(new URL(request.url()).pathname).toBe("/api/auth/login");
  expect(new URL(request.url()).search).toBe("");
  expect(new URLSearchParams(request.postData() ?? "").get("password")).toBe(dummyPassword);
  await page.waitForURL(/\/api\/auth\/login$/);
  expect(page.url()).not.toContain(dummyPassword);
  // The JSON-only API must reject native URL-encoded bodies without authenticating.
  const response = await request.response();
  expect(response?.status()).toBe(415);
  expect((await page.context().cookies()).some(cookie => cookie.name === "mua_session")).toBe(false);
});

test("hydrated password login still posts JSON and redirects without credential query parameters", async ({ page, baseURL }) => {
  const login = await credentials(), errors: string[] = [], exposed: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { const url = new URL(request.url()); if (url.searchParams.has("password") || url.searchParams.has("username")) exposed.push(url.pathname); });
  try {
    await page.goto("/login");
    await expect(page.locator('input[name="username"]')).toBeHidden();
    await page.getByRole("button", { name: "使用账号密码登录", exact: true }).click();
    await page.locator('input[name="username"]').fill(login.username);
    await page.locator('input[name="password"]').fill(login.password);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
    await page.locator('button[type="submit"]').click();
    const result = await response;
    expect(result.status()).toBe(200);
    expect(result.request().headers()["content-type"]).toBe("application/json");
    expect(new URL(result.request().url()).search).toBe("");
    await expect(page).toHaveURL(`${baseURL}/admin`);
    expect(exposed).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/auth/logout", { headers: { Origin: baseURL! }, data: {} });
  }
});
