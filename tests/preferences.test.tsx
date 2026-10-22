import { fixtureClientId } from "./fixtures/identity";
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
import { formatMessage, diagnosticText } from "../src/lib/diagnostics";
import { probeTooltip } from "../src/lib/server-probe-contract";

const state: State = { actor: { id: "00000000-0000-4000-8000-000000000001", displayName: "总览", isSuperAdmin: true }, organizations: [], accounts: [], events: [], auditActivity: [], enabledPackageFormats: [1, 2], maxUploadSizeMb: 1024 };
const render = (locale: Locale, children: React.ReactNode) => renderToStaticMarkup(<PreferenceProvider initialLocale={locale}><AdminProvider initial={state}>{children}</AdminProvider></PreferenceProvider>);

test("locale validation defaults to Chinese and dictionaries cover all migrated UI messages", () => {
  for (const value of [undefined, "fr-FR", "en-US<script>", "en"]) assert.equal(parseLocale(value), "zh-CN");
  assert.equal(parseLocale("en-US"), "en-US");
  assert.equal(translate("en-US", "navigation.servers"), "Server management");
  assert.equal(translate("en-US", "navigation.clients"), "Client management");
  assert.equal(translate("zh-CN", "navigation.servers"), "服务器管理");
});

test("translated templates preserve supplied business text and localize dynamic size errors", () => {
  const en = (key: string, values?: Record<string, unknown>) => translate("en-US", key, values);
  assert.equal(en("clients.binding.replaceConfirmation", { server: "总览", client: "客户端管理" }), "Server “总览” currently uses “客户端管理”. Switch to the new client once it’s approved and published? The original client and version history will be kept.");
  assert.equal(formatMessage(en, diagnosticText("diagnostics.clientService.theUploadExceedsTheMaximumAllowedSize0Mb", { arg0: 1024 })), "The upload exceeds the maximum allowed size (1024 MB)");
  assert.equal(translate("zh-CN", "navigation.settings"), "设置");
  assert.equal(translate("en-US", "用户写的说明"), "用户写的说明");
  assert.equal(en("auth.roles.organizationAdministrator", { organization: "$&{1}" }), "$&{1} · Organization administrator");
  assert.equal(en("serverStatus.clickTheStatusLightToRefreshResultsAreBriefly"), "\nClick the status light to refresh. Results may take a moment to update.");
  assert.equal(formatMessage(en, diagnosticText("validation.maxCharacters", { max: 255 })), "At most 255 characters");
  assert.equal(translate("en-US", "服务器管理"), "服务器管理", "business text is no longer looked up as a translation key");
});

test("Chinese and English login, settings and table controls render in the selected locale", () => {
  const en = render("en-US", <><LoginForm /><SettingsPage /><DataTable data={[]} columns={[]} /></>);
  for (const value of ["Sign in to Union Link", "Username", "Password", "Maximum upload size (MB)", "Save upload size", "No records", "Next page", "Change language", "Toggle light / dark theme"]) assert(en.includes(value), value);
  for (const value of ["登录 Union Link", "账号安全", "暂无记录", "最大上传大小"]) assert(!en.includes(value), value);
  assert(en.includes('value="1024"'));
  const zh = render("zh-CN", <><LoginForm /><SettingsPage /></>); assert(zh.includes("登录 Union Link")); assert(zh.includes("最大上传大小"));
});

test("login and password forms cannot submit credentials as URL parameters before hydration", () => {
  const html = render("zh-CN", <><LoginForm /><SettingsPage /></>);
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  assert(forms.length >= 2);
  assert(forms.some(form => form.includes('action="/api/auth/login"')));
  for (const form of forms) {
    assert.match(form, /^<form\b[^>]*\bmethod="post"/, "native form submissions must use POST");
    assert(form.includes('<fieldset disabled=""'), "server-rendered forms must wait for their JSON handlers");
  }
});

test("English server editor keeps saved names, descriptions, addresses and RBAC field identifiers unchanged", () => {
  const server: Server = { serverId: "NPA", organizationId: state.actor.id, displayName: "服务器管理", description: "这是用户填写的说明", gameAddress: "mc.example.edu:25565", iconObjectKey: null, mottoImageUrl: null,
    sortOrder: 0, themeColor: null, isListed: false, displayMode: "PERMANENT", displayStartsAt: null, displayEndsAt: null, archivedAt: null, clientArchivedAt: null, currentReleaseId: null, currentReleaseActive: false, publicationRevision: 0, boundClientId: fixtureClientId(null), boundClientName: null, permissions: ["SERVER_READ", "SERVER_EDIT"] };
  const en = render("en-US", <ServerEditorContent server={server} onSaved={() => {}} />);
  assert(en.includes("Server motto")); assert(en.includes('name="gameAddress"')); assert(en.includes('value="服务器管理"')); assert(en.includes("这是用户填写的说明")); assert(en.includes("mc.example.edu:25565"));
});

test("probe tooltips and dates follow locale without changing measurements", () => {
  const tooltip = probeTooltip({ state: "HIGH_LATENCY", address: "mc.example.edu", checkedAt: "2026-10-12T02:30:00.000Z", latencyMs: 550, latencyKind: "PONG", highLatencyMs: 300, message: diagnosticText("diagnostics.serverProbe.minecraftServerOnlineWithHighLatency"), version: "1.21.1", playersOnline: 5 }, "en-US");
  assert(tooltip.includes("Minecraft server online with high latency")); assert(tooltip.includes("Response time 550 ms")); assert(tooltip.includes("High latency above 300 ms")); assert(tooltip.includes("Online players: 5")); assert(!/[\u3400-\u9fff]/.test(tooltip));
  assert.notEqual(localizedDate("2026-10-12T02:30:00Z", "en-US"), localizedDate("2026-10-12T02:30:00Z", "zh-CN"));
});

test("language and theme controls are accessible and emit pre-paint theme restoration", () => {
  const html = render("en-US", <PreferenceControls />);
  assert(html.includes('aria-label="Change language"')); assert(html.includes('aria-label="Toggle light / dark theme"'));
  assert(html.includes("mua-theme")); assert(html.includes('dark:hidden')); assert(html.includes('dark:block'));
});
