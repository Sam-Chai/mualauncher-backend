import { fixtureClientId } from "./fixtures/identity";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminProvider, type Server, type State } from "../src/components/admin/provider";
import { ServerEditorContent, ServersPage } from "../src/components/admin/servers";
import { MottoCropGrid, MottoPreview } from "../src/components/admin/server-motto";
import { mottoCrop, SERVER_MOTTO_RATIO } from "../src/lib/server-motto-contract";
import { ProbeLamp, ServerStatusLight } from "../src/components/admin/server-status";
import type { ServerProbeResult } from "../src/lib/server-probe-contract";
import { currentNavigation, navigation } from "../src/components/admin/navigation";
import { visibleNavigation } from "../src/components/admin/navigation-access";
import { rolePermissions } from "../src/lib/roles";
import { SettingsPage } from "../src/components/admin/system";
import { uploadFileError, UPLOAD_MB } from "../src/lib/upload-size-policy";
import { displayTimeInput, displayTimeIso, displayWindowOpen } from "../src/lib/server-display";
import { DisplayScheduleNote } from "../src/components/admin/display-schedule";
import { PreferenceProvider } from "../src/components/preferences";
import { AccountIdentity } from "../src/components/admin/account-identity";

test("Union identities show their complete subject without inventing a local username; PLAYER grants no management permissions", () => {
  const union=renderToStaticMarkup(<AccountIdentity username="" unionSubject="MUA:9917" />);
  assert(union.includes("Union ·"));assert(union.includes("MUA:9917"));assert(!union.includes("@"));
  const local=renderToStaticMarkup(<AccountIdentity username="mua-admin" />);assert(local.includes("@mua-admin"));assert(!local.includes("Union"));
  const linked=renderToStaticMarkup(<AccountIdentity username="local" unionSubject="NPU:123" />);assert(linked.includes("@local"));assert(linked.includes("NPU:123"));
  const en=renderToStaticMarkup(<PreferenceProvider initialLocale="en-US"><AccountIdentity /></PreferenceProvider>);assert(en.includes("No sign-in identity configured"));
  assert.deepEqual(rolePermissions.PLAYER,[]);
});

function fixture(permissions: Server["permissions"], superAdmin = false) {
  const server: Server = {
    serverId: "NPB", organizationId: "00000000-0000-4000-8000-000000000001", displayName: "NPU BETA", description: "Test server",
    gameAddress: "beta.example.edu:25565", iconObjectKey: null, mottoImageUrl: null, sortOrder: 3, themeColor: "#123456", isListed: true, displayMode: "PERMANENT", displayStartsAt: null, displayEndsAt: null,
    archivedAt: null, clientArchivedAt: null, currentReleaseId: "00000000-0000-4000-8000-000000000002", currentReleaseActive: true,
    publicationRevision: 1, boundClientId: fixtureClientId("00000000-0000-4000-8000-000000000003"), boundClientName: "Beta client", permissions,
  };
  const state: State = {
    actor: { id: "00000000-0000-4000-8000-000000000004", displayName: "Tester", isSuperAdmin: superAdmin },
    organizations: [{ id: server.organizationId, displayName: "NPU", description: "", clientCount: 1, avatarObjectKey: null, archivedAt: null, permissions: [], servers: [server], members: [] }],
    accounts: [], events: [], auditActivity: [], enabledPackageFormats: [1, 2], maxUploadSizeMb: 1024,
  };
  return { state, server };
}

function editor(state: State, server: Server) {
  return renderToStaticMarkup(<AdminProvider initial={state}><ServerEditorContent server={server} onSaved={() => {}} /></AdminProvider>);
}

test("scheduled display uses Beijing time, validates calendar dates and shows translated status subtitles", () => {
  assert.equal(displayTimeIso("2026-10-12T08:00"), "2026-10-12T00:00:00.000Z");
  assert.equal(displayTimeInput("2026-10-12T00:00:00.000Z"), "2026-10-12T08:00:00");
  assert.equal(displayTimeIso("2026-02-30T08:00"), null);
  const { state, server } = fixture([], true);
  server.displayMode = "RANGE"; server.displayStartsAt = new Date("2026-10-12T00:00:00Z"); server.displayEndsAt = new Date("2026-10-13T00:00:00Z");
  assert.equal(displayWindowOpen(server, server.displayStartsAt), true);
  assert.equal(displayWindowOpen(server, server.displayEndsAt), false);
  const html = editor(state, server);
  assert(html.includes('type="datetime-local"')); assert(html.includes('name="displayStartsAt"')); assert(html.includes("区间展示："));
  const en = renderToStaticMarkup(<PreferenceProvider initialLocale="en-US"><DisplayScheduleNote schedule={server} /></PreferenceProvider>);
  assert(en.includes("Display window:")); assert(!en.includes("区间展示"));
  assert.equal(renderToStaticMarkup(<DisplayScheduleNote schedule={{ ...server, displayMode: "PERMANENT" }} />), "");
  state.actor.isSuperAdmin = false; server.permissions = ["SERVER_READ", "SERVER_EDIT"];
  const limited = editor(state, server);
  assert(limited.includes("区间展示：")); assert(limited.includes('name="displayStartsAt"'));
});

test("upload size setting is shown only to the MUA superadmin with MB units and the 1024 default", () => {
  for (const superAdmin of [true, false]) {
    const { state } = fixture([...rolePermissions.ORG_ADMIN], superAdmin);
    const html = renderToStaticMarkup(<AdminProvider initial={state}><SettingsPage /></AdminProvider>);
    assert.equal(html.includes('name="maxUploadSizeMb"'), superAdmin);
    assert.equal(html.includes("保存上传大小"), superAdmin);
    if (superAdmin) { assert(html.includes('value="1024"')); assert(html.includes("文件大小（MB）")); }
  }
});

test("upload chooser validates the configured byte boundary for ZIP and mrpack files", () => {
  for (const fileName of ["client.zip", "recipe.mrpack", "PCL.ZIP"]) {
    assert.equal(uploadFileError(fileName, 1024 * UPLOAD_MB, 1024), null);
    assert.match(uploadFileError(fileName, 1024 * UPLOAD_MB + 1, 1024)!, /1024 MB/);
    assert.equal(uploadFileError(fileName, 2048 * UPLOAD_MB, 2048), null);
  }
  assert(uploadFileError("client.zip", 0, 1024)); assert(uploadFileError("client.txt", 1, 1024));
});

test("superadmin edits server details and listing in one form with archive controls", () => {
  const { state, server } = fixture([], true);
  const html = editor(state, server);
  assert.equal((html.match(/<form /g) ?? []).length, 1);
  for (const name of ["displayName", "description", "gameAddress", "sortOrder", "themeColor"]) assert(html.includes(`name="${name}"`), name);
  assert(html.includes("服务器箴言")); assert(html.includes("上传图片")); assert(!html.includes("图标对象键"));
  assert(html.includes(">标记上架<")); assert(html.includes('aria-label="归档管理"'));
  assert(html.includes("公开分发")); assert(html.includes("Beta client"));
});

test("organization and server editors see detail controls without global listing or archive controls", () => {
  for (const role of ["ORG_ADMIN", "SERVER_ADMIN", "SERVER_EDITOR"] as const) {
    const { state, server } = fixture([...rolePermissions[role]]);
    const html = editor(state, server);
    assert(html.includes('name="displayName"'), role); assert(html.includes('name="gameAddress"'), role);
    assert(html.includes("展示颜色")); assert(html.includes("#123456")); assert(html.includes("展示模式")); assert(html.includes("永久展示"));
    assert(html.includes('name="themeColor"'));
    for (const forbidden of ['name="sortOrder"', ">标记上架<", 'aria-label="归档管理"']) assert(!html.includes(forbidden), `${role}: ${forbidden}`);
  }
});

test("superadmin registration chooses a display mode and scoped editors can change color and display windows", () => {
  const { state, server } = fixture([], true);
  const registration = renderToStaticMarkup(<AdminProvider initial={state}><ServerEditorContent onSaved={() => {}} /></AdminProvider>);
  assert(registration.includes("展示模式")); assert(registration.includes("区间仅控制目录展示"));
  assert(!registration.includes('name="displayStartsAt"')); assert(!registration.includes('name="themeColor"'));
  server.displayMode = "RANGE"; server.displayStartsAt = new Date("2026-10-13T00:00:00Z"); server.displayEndsAt = new Date("2026-10-14T00:00:00Z");
  for (const role of ["ORG_ADMIN", "SERVER_ADMIN", "SERVER_EDITOR"] as const) {
    state.actor.isSuperAdmin = false; server.permissions = [...rolePermissions[role]];
    const html = editor(state, server);
    assert(html.includes("区间展示")); assert(html.includes("#123456")); assert(html.includes("2026"));
    assert(html.includes('name="displayStartsAt"')); assert(html.includes('name="themeColor"'));
  }
});

test("readers and reviewers see server details and status without any write controls", () => {
  for (const role of ["READ_ONLY", "REVIEWER", "CLIENT_EDITOR"] as const) {
    const { state, server } = fixture([...rolePermissions[role]]);
    const html = editor(state, server);
    assert(html.includes("NPU BETA")); assert(html.includes("beta.example.edu:25565")); assert(html.includes("公开分发"));
    assert(!html.includes("<form")); assert(!html.includes("<input")); assert(!html.includes('aria-label="归档管理"'));
    assert(!html.includes("上传图片")); assert(!html.includes("重新裁剪")); assert(!html.includes("移除图片"));
  }
});

test("archived resources expose status and restoration without a mutable detail form", () => {
  const { state, server } = fixture([], true);
  server.archivedAt = new Date(); server.currentReleaseActive = false; server.isListed = false;
  const archived = editor(state, server);
  assert(archived.includes("服务器已归档")); assert(archived.includes("恢复服务器")); assert(!archived.includes("<form"));
  server.archivedAt = null; state.organizations[0].archivedAt = new Date();
  const organizationArchived = editor(state, server);
  assert(organizationArchived.includes("组织已归档")); assert(organizationArchived.includes("请先恢复所属组织")); assert(!organizationArchived.includes("<form"));
});

test("unified server navigation and table retain truthful distribution and binding states", () => {
  const { state, server } = fixture([...rolePermissions.READ_ONLY]);
  const links = visibleNavigation(navigation, state).find(group => group.title === "服务器")?.items;
  assert.deepEqual(links?.map(({ title, href }) => ({ title, href })), [{ title: "服务器管理", href: "/admin/servers" }]);
  assert.equal(currentNavigation("/admin/servers/status").title, "服务器管理");
  server.currentReleaseActive = false;
  let html = editor(state, server);
  assert(html.includes("等待有效发布")); assert(html.includes("当前发布已归档")); assert(!html.includes("公开分发"));
  server.currentReleaseId = null; server.boundClientId = null; server.boundClientName = null;
  html = renderToStaticMarkup(<AdminProvider initial={state}><ServersPage /></AdminProvider>);
  assert(html.includes("服务器管理")); assert(html.includes("目录状态")); assert(html.includes("未绑定客户端"));
  assert(html.includes("悬停查看延迟与原因")); assert(html.includes("查看")); assert(!html.includes("登记服务器"));
  assert([...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)][0][1].includes("服务器箴言"));
});

test("table motto fills its cell and reveals the theme background; editor preserves the full unfaded image", () => {
  const { state, server } = fixture([...rolePermissions.SERVER_EDITOR]);
  server.mottoImageUrl = "/api/admin/servers/NPB/motto-image?version=test";
  const table = renderToStaticMarkup(<AdminProvider initial={state}><ServersPage /></AdminProvider>);
  const cell = table.match(/<td[^>]*>([\s\S]*?data-server-motto="table"[\s\S]*?)<\/td>/);
  assert(cell); assert(cell[0].includes("relative w-48 p-0"));
  assert(cell[0].includes("aspect-ratio:2.35")); assert(cell[0].includes("mask-image:linear-gradient(to right, black 61.8034%, transparent 100%)"));
  assert(!cell[0].includes("rounded-md")); assert(!cell[0].includes("bg-white"));
  const html = editor(state, server);
  assert(html.includes('alt="NPU BETA箴言"')); assert(html.includes("2.35:1"));
  assert(html.includes("object-contain")); assert(!html.includes("mask-image"));
  const prepared = renderToStaticMarkup(<MottoPreview src={null} alt="Prepared" draft={{ file: {} as File, crop: mottoCrop(610, 400), width: 610, height: 400, previewUrl: "blob:prepared" }} />);
  assert(prepared.includes("blob:prepared")); assert(!prepared.includes("mask-image"));
  const crop = mottoCrop(610, 400);
  const grid = renderToStaticMarkup(<MottoCropGrid source={{ url: "/image.webp", width: 610, height: 400 }} crop={crop} onChange={() => {}} />);
  assert(grid.includes('viewBox="0 0 610 400"')); assert.equal((grid.match(/<line /g) ?? []).length, 4);
  const selection = grid.match(/<rect\b[^>]*width="([^"]+)"[^>]*height="([^"]+)"/);
  assert(selection); assert(Math.abs(Number(selection[1]) - 610) < 1e-6); assert(Math.abs(Number(selection[1]) / Number(selection[2]) - SERVER_MOTTO_RATIO) < 1e-6);
  assert(grid.includes('role="application"')); assert(grid.includes("方向键移动"));
});

test("probe lamps expose green, yellow, red and unconfirmed states with latency and failure tooltips", () => {
  const base: ServerProbeResult = { state: "ONLINE", address: "game.test", checkedAt: "2026-10-12T12:00:00.000Z", latencyMs: 80, latencyKind: "PONG", highLatencyMs: 300, message: "Minecraft 服务器在线", version: "1.21.1", playersOnline: 2 };
  const green = renderToStaticMarkup(<ProbeLamp result={base} />);
  assert(green.includes("bg-emerald-500")); assert(green.includes("延迟 80 ms")); assert(green.includes("后端探测")); assert(green.includes("检查时间"));
  const yellow = renderToStaticMarkup(<ProbeLamp result={{ ...base, state: "HIGH_LATENCY", latencyMs: 350, message: "Minecraft 服务器在线，延迟较高" }} />);
  assert(yellow.includes("bg-amber-400")); assert(yellow.includes("延迟 350 ms")); assert(yellow.includes("高延迟阈值"));
  const red = renderToStaticMarkup(<ProbeLamp result={{ ...base, state: "OFFLINE", latencyMs: null, latencyKind: null, version: null, playersOnline: null, message: "连接失败，服务器未启动或网络不可达" }} />);
  assert(red.includes("bg-red-500")); assert(red.includes("网络不可达")); assert(!red.includes("延迟 80"));
  const unset = renderToStaticMarkup(<ServerStatusLight serverId="NPA" address={null} />);
  assert(unset.includes("bg-neutral-400")); assert(unset.includes("尚未设置服务器连接地址")); assert(!unset.includes("bg-red-500"));
  const archived = renderToStaticMarkup(<ServerStatusLight serverId="NPA" address="game.test" archived />);
  assert(archived.includes("已归档，未执行探测")); assert(!archived.includes("bg-red-500"));
});
