import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferenceProvider, PreferenceControls } from "../src/components/preferences";
import { AdminProvider, type State, type Server } from "../src/components/admin/provider";
import { SettingsPage } from "../src/components/admin/system";
import { ServerEditorContent } from "../src/components/admin/servers";
import { DataTable } from "../src/components/admin/data-table";
import LoginForm from "../src/components/login-form";
import { localizedDate, parseLocale, translate, type Locale } from "../src/lib/i18n";
import { probeTooltip } from "../src/lib/server-probe-contract";
import english from "../src/lib/locales/en.json";

const state: State = { actor: { id: "00000000-0000-4000-8000-000000000001", displayName: "总览", isSuperAdmin: true }, organizations: [], accounts: [], events: [], auditActivity: [], enabledPackageFormats: [1, 2], maxUploadSizeMb: 1024 };
const render = (locale: Locale, children: React.ReactNode) => renderToStaticMarkup(<PreferenceProvider initialLocale={locale}><AdminProvider initial={state}>{children}</AdminProvider></PreferenceProvider>);

test("locale validation defaults to Chinese and dictionaries cover all migrated UI messages", () => {
  for (const value of [undefined, "fr-FR", "en-US<script>", "en"]) assert.equal(parseLocale(value), "zh-CN");
  assert.equal(parseLocale("en-US"), "en-US");
  assert(Object.keys(english).length >= 698);
  for (const [source, target] of Object.entries(english)) {
    assert(target.length > 0); assert(!/[\u3400-\u9fff]/.test(target), source);
    const tokens = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
    assert.deepEqual(tokens(target), tokens(source), source);
  }
});

test("translated templates preserve supplied business text and localize dynamic size errors", () => {
  assert.equal(translate("en-US", "服务器“{0}”已绑定“{1}”。是否在新客户端审核发布后重新绑定到新客户端？原客户端与历史版本会保留。", { "0": "总览", "1": "客户端管理" }), "Server “总览” is bound to “客户端管理”. Replace the binding after the new client is reviewed and published? The original client and version history will be kept.");
  assert.equal(translate("en-US", "上传文件超过允许的最大大小（1024 MB）"), "Upload exceeds the maximum allowed size (1024 MB)");
  assert.equal(translate("zh-CN", "Settings"), "设置");
  assert.equal(translate("en-US", "用户写的说明"), "用户写的说明");
  assert.equal(translate("en-US", "$&{1} · 组织管理员"), "$&{1} · Organization administrator");
  assert.equal(translate("en-US", "\n点击状态灯可刷新（结果短暂缓存）。"), "\nClick the status light to refresh (results are briefly cached).");
});

test("Chinese and English login, settings and table controls render in the selected locale", () => {
  const en = render("en-US", <><LoginForm /><SettingsPage /><DataTable data={[]} columns={[]} /></>);
  for (const value of ["Sign in to management", "Username", "Password", "Maximum muapack upload size (MB)", "Save upload size", "No records", "Next page", "Change language", "Toggle light / dark theme"]) assert(en.includes(value), value);
  for (const value of ["登录管理平台", "账号安全", "暂无记录", "允许最大上传 muapack"]) assert(!en.includes(value), value);
  assert(en.includes('value="1024"'));
  const zh = render("zh-CN", <><LoginForm /><SettingsPage /></>); assert(zh.includes("登录管理平台")); assert(zh.includes("允许最大上传 muapack"));
});

test("English server editor keeps saved names, descriptions, addresses and RBAC field identifiers unchanged", () => {
  const server: Server = { serverId: "NPA", organizationId: state.actor.id, displayName: "服务器管理", description: "这是用户填写的说明", gameAddress: "mc.example.edu:25565", iconObjectKey: null, mottoImageUrl: null,
    sortOrder: 0, themeColor: null, isListed: false, archivedAt: null, clientArchivedAt: null, currentReleaseId: null, currentReleaseActive: false, publicationRevision: 0, boundClientId: null, boundClientName: null, permissions: ["SERVER_READ", "SERVER_EDIT"] };
  const en = render("en-US", <ServerEditorContent server={server} onSaved={() => {}} />);
  assert(en.includes("Server motto")); assert(en.includes('name="gameAddress"')); assert(en.includes('value="服务器管理"')); assert(en.includes("这是用户填写的说明")); assert(en.includes("mc.example.edu:25565"));
});

test("probe tooltips and dates follow locale without changing measurements", () => {
  const tooltip = probeTooltip({ state: "HIGH_LATENCY", address: "mc.example.edu", checkedAt: "2026-10-12T02:30:00.000Z", latencyMs: 550, latencyKind: "PONG", highLatencyMs: 300, message: "Minecraft 服务器在线，延迟较高", version: "1.21.1", playersOnline: 5 }, "en-US");
  assert(tooltip.includes("Minecraft server online with high latency")); assert(tooltip.includes("Latency 550 ms")); assert(tooltip.includes("High latency threshold: 300 ms")); assert(tooltip.includes("Online players: 5")); assert(!/[\u3400-\u9fff]/.test(tooltip));
  assert.notEqual(localizedDate("2026-10-12T02:30:00Z", "en-US"), localizedDate("2026-10-12T02:30:00Z", "zh-CN"));
});

test("language and theme controls are accessible and emit pre-paint theme restoration", () => {
  const html = render("en-US", <PreferenceControls />);
  assert(html.includes('aria-label="Change language"')); assert(html.includes('aria-label="Toggle light / dark theme"'));
  assert(html.includes("mua-theme")); assert(html.includes('dark:hidden')); assert(html.includes('dark:block'));
});
