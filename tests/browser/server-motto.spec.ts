import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import type { State, Server } from "../../src/components/admin/provider";

async function credentials() {
  if (process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD) return { username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD };
  const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
  if (!file) throw new Error("Set SMOKE_USERNAME and SMOKE_PASSWORD for an existing local test account.");
  const contents = await readFile(`.local/${file}`, "utf8");
  const username = contents.match(/^Username: (.+)$/m)?.[1], password = contents.match(/^Password: (.+)$/m)?.[1];
  if (!username || !password) throw new Error("Missing local smoke credentials.");
  return { username, password };
}

test("motto fills the table cell in both themes, editor shows the whole image and legacy crops adapt", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  expect((await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: await credentials() })).status()).toBe(200);
  const cookie = (await page.context().cookies(baseURL!)).find(value => value.name === "mua_session");
  try {
    const state: State = await (await page.request.get("/api/admin/state")).json();
    const server: Server = {
      serverId: "MOV", organizationId: "00000000-0000-4000-8000-000000000001", displayName: "Cinema fixture", description: "Browser-only fixture",
      gameAddress: "", iconObjectKey: "fixture", mottoImageUrl: "/api/admin/servers/MOV/motto-image?version=fixture", sortOrder: 0, themeColor: null,
      isListed: false, displayMode: "PERMANENT", displayStartsAt: null, displayEndsAt: null, archivedAt: null, clientArchivedAt: null,
      currentReleaseId: null, currentReleaseActive: false, publicationRevision: 0, boundClientId: null, boundClientName: null, permissions: ["SERVER_READ", "SERVER_EDIT"],
    };
    state.organizations = [{ id: server.organizationId, displayName: "Cinema", description: "", clientCount: 0, avatarObjectKey: null, archivedAt: null, permissions: [], servers: [server], members: [] }];
    // Read-only browser fixtures: no server/image business records are written.
    await page.route("**/api/admin/state", route => route.fulfill({ json: state }));
    const source = await sharp({ create: { width: 610, height: 400, channels: 3, background: "#c05020" } }).webp().toBuffer();
    const legacyImage = await sharp(source).resize(1220, 460).webp().toBuffer();
    await page.route("**/api/admin/servers/MOV/motto-image?*", route => {
      const variant = new URL(route.request().url()).searchParams.get("variant");
      return variant === "metadata" ? route.fulfill({ json: { version: 1, width: 610, height: 400, crop: { left: 0, top: .2125, width: 1, height: .575 }, sourceSha256: "0".repeat(64), imageSha256: "0".repeat(64) } })
        : route.fulfill({ contentType: "image/webp", body: variant === "source" ? source : legacyImage });
    });
    await page.goto("/admin/servers");
    await page.getByRole("button", { name: "刷新数据", exact: true }).click();
    const preview = page.locator('[data-server-motto="table"]');
    await expect(preview).toHaveCount(1);
    await expect(preview.locator("img")).toBeVisible();
    await preview.locator("img").evaluate((img: HTMLImageElement) => img.decode());
    const cell = preview.locator("..");
    const geometry = await cell.evaluate(element => {
      const image = element.querySelector("img")!, a = element.getBoundingClientRect(), b = image.getBoundingClientRect(), style = getComputedStyle(element);
      return { delta: [a.left - b.left, a.top - b.top, a.right - b.right, a.bottom - b.bottom], padding: [style.paddingLeft, style.paddingTop, style.paddingRight, style.paddingBottom], radius: getComputedStyle(image.parentElement!).borderRadius };
    });
    expect(geometry.padding).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.delta.every(value => Math.abs(value) <= 1)).toBe(true);
    expect(geometry.radius).toBe("0px");
    const backgrounds: number[] = [];
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "切换黑白主题", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.mouse.move(0, 0);
      const screenshot = await cell.screenshot({ path: `.local/motto-${theme}.png` });
      const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x: number) => [...data.subarray((Math.floor(info.height / 2) * info.width + x) * info.channels, (Math.floor(info.height / 2) * info.width + x) * info.channels + 3)];
      const left = at(2), right = at(info.width - 2);
      expect(Math.max(...left.map((value, i) => Math.abs(value - right[i])))).toBeGreaterThan(40);
      if (theme === "light") expect(Math.min(...right)).toBeGreaterThan(235);
      else expect(Math.max(...right)).toBeLessThan(45);
      backgrounds.push(right[0]);
      await page.screenshot({ path: `.local/motto-table-${theme}.png` });
    }
    expect(backgrounds[0] - backgrounds[1]).toBeGreaterThan(190);
    await cell.locator("..").getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.locator('[data-server-motto="preview"]');
    await expect(editor.locator("img")).toBeVisible();
    expect(await editor.locator("img").evaluate(element => getComputedStyle(element).objectFit)).toBe("contain");
    expect(await editor.locator("div").evaluate(element => getComputedStyle(element).maskImage)).toBe("none");
    await editor.screenshot({ path: ".local/motto-editor.png" });
    await page.getByRole("button", { name: "重新裁剪", exact: true }).click();
    const grid = page.getByRole("application", { name: "图片裁剪网格，拖动选区或使用方向键移动" });
    await expect(grid).toBeVisible();
    const selection = grid.locator("rect");
    expect(Number(await selection.getAttribute("width")) / Number(await selection.getAttribute("height"))).toBeCloseTo(2.35, 6);
    const before = Number(await selection.getAttribute("y"));
    await grid.focus(); await grid.press("ArrowDown");
    await expect.poll(async () => Number(await selection.getAttribute("y"))).toBeGreaterThan(before);
    const bounds = (await grid.boundingBox())!;
    const moved = Number(await selection.getAttribute("y"));
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 15); await page.mouse.up();
    await expect.poll(async () => Number(await selection.getAttribute("y"))).toBeGreaterThan(moved);
    await page.getByRole("button", { name: "重置选区", exact: true }).click();
    expect(Number(await selection.getAttribute("width")) / Number(await selection.getAttribute("height"))).toBeCloseTo(2.35, 6);
    await grid.screenshot({ path: ".local/motto-crop.png" });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.goto("/admin/system/settings");
    await expect(page.getByText("已接入 · 保留应用层 RBAC", { exact: true })).toBeVisible();
    await page.goto("/admin/permissions");
    await expect(page.getByText(/PostgreSQL RLS 已作为第二层安全保护/)).toBeVisible();
    await page.getByRole("button", { name: "切换语言", exact: true }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await expect(page.getByText(/PostgreSQL RLS provides a second security layer/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (cookie) await fetch(`${baseURL}/api/auth/logout`, { method: "POST", headers: { Origin: baseURL!, Cookie: `${cookie.name}=${cookie.value}`, "Content-Type": "application/json" }, body: "{}" });
  }
});
