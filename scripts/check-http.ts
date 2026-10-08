import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

async function main() {
  const base = process.env.SMOKE_ORIGIN ?? process.env.APP_ORIGIN ?? "http://localhost:3000";
  let username = process.env.SMOKE_USERNAME;
  let password = process.env.SMOKE_PASSWORD;
  if (!username || !password) {
    const file = (await readdir(".local")).filter(name => /^initial-admin-\d+\.txt$/.test(name)).sort().at(-1);
    assert(file, "Provide SMOKE_USERNAME and SMOKE_PASSWORD, or bootstrap a local administrator first.");
    const credentials = await readFile(`.local/${file}`, "utf8");
    username = credentials.match(/^Username: (.+)$/m)?.[1];
    password = credentials.match(/^Password: (.+)$/m)?.[1];
  }
  assert(username && password, "Missing smoke-test credentials");
  let cookie = "";
  const post = (path: string, body: unknown, origin = base) => fetch(base + path, { method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  try {
    const page = await fetch(base + "/login");
    const loginHtml = await page.text();
    assert.equal(page.status, 200); assert(loginHtml.includes("登录管理平台"));
    assert(!/:E\{[^\n]*digest/.test(loginHtml), "Login rendered a React server error");
    assert.equal((await fetch(base + "/api/admin/state")).status, 401);
    assert.equal((await post("/api/auth/login", {}, "https://untrusted.example")).status, 403);
    assert.equal((await post("/api/auth/login", { username, password, isSuperAdmin: true })).status, 400);
    assert.equal((await post("/api/auth/login", { tooLarge: "a".repeat(33000) })).status, 413);
    const signedIn = await post("/api/auth/login", { username, password });
    assert.equal(signedIn.status, 200, "Local administrator login failed");
    const header = signedIn.headers.get("set-cookie")!;
    cookie = header.split(";")[0];
    assert(header.includes("HttpOnly")); assert(/SameSite=strict/i.test(header));
    assert.equal(header.includes("Secure"), base.startsWith("https://"));
    const state = await fetch(base + "/api/admin/state", { headers: { Cookie: cookie } });
    assert.equal(state.status, 200);
    const data = await state.json();
    assert.equal(data.actor.isSuperAdmin, true); assert(Array.isArray(data.organizations));
    assert.equal(data.auditActivity.length, 14);
    assert(!JSON.stringify(data).includes("passwordHash")); assert(!JSON.stringify(data).includes(password));
    const root = await fetch(base, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(root.status, 307); assert.equal(root.headers.get("location"), "/admin");
    const panel = await fetch(base + "/admin", { headers: { Cookie: cookie } });
    const panelHtml = await panel.text();
    assert.equal(panel.status, 200); assert(panelHtml.includes("MUA Platform")); assert(panelHtml.includes("服务器目录"));
    assert(panelHtml.includes('tremor-id="tremor-raw"'), "Dashboard must render the Tremor chart");
    assert(/<div width="[1-9]\d*" height="[1-9]\d*" class="recharts-wrapper"/.test(panelHtml), "Chart must have positive initial dimensions");
    assert(!/:E\{[^\n]*digest/.test(panelHtml), "Panel rendered a React server error");
    for (const path of ["/admin/organizations", "/admin/members", "/admin/permissions", "/admin/servers", "/admin/listings",
      "/admin/servers/status", "/admin/clients", "/admin/clients/releases", "/admin/clients/artifacts", "/admin/clients/runtime",
      "/admin/news", "/admin/events", "/admin/launcher-ui", "/admin/releases/review", "/admin/releases/published",
      "/admin/releases/revoked", "/admin/system/workers", "/admin/system/storage", "/admin/system/signing-keys",
      "/admin/system/audit", "/admin/system/settings"]) {
      const response = await fetch(base + path, { headers: { Cookie: cookie } });
      const html = await response.text();
      assert.equal(response.status, 200, path); assert(html.includes("MUA Platform"), path);
      assert(!/:E\{[^\n]*digest/.test(html), `React server error at ${path}`);
    }
    const directory = await fetch(base + "/api/v1/servers");
    assert.equal(directory.status, 200); assert(Array.isArray((await directory.json()).servers));
    assert.equal((await post("/api/auth/logout", {})).status, 200);
    assert.equal((await fetch(base + "/api/admin/state", { headers: { Cookie: cookie } })).status, 401);
    const denied = await fetch(base + "/admin/system/audit", { headers: { Cookie: cookie } });
    const deniedHtml = await denied.text();
    assert(denied.url.endsWith("/login") || deniedHtml.includes('url=/login') || deniedHtml.includes('NEXT_REDIRECT'), "Admin pages must redirect after session revocation");
    cookie = "";
    console.log("HTTP checks passed: /admin dashboard and 21 module routes, authentication, origin/field/body guards, cookie flags, safe DTOs, complete audit metrics, public directory and session revocation.");
  } finally { if (cookie) await post("/api/auth/logout", {}); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "HTTP check failed"); process.exitCode = 1; });
