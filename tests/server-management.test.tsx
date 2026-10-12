import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminProvider, type Server, type State } from "../src/components/admin/provider";
import { ServerEditorContent, ServersPage } from "../src/components/admin/servers";
import { MottoCropGrid, MottoPreview } from "../src/components/admin/server-motto";
import { mottoCrop } from "../src/lib/server-motto-contract";
import { ProbeLamp, ServerStatusLight } from "../src/components/admin/server-status";
import type { ServerProbeResult } from "../src/lib/server-probe-contract";
import { currentNavigation, navigation } from "../src/components/admin/navigation";
import { visibleNavigation } from "../src/components/admin/navigation-access";
import { rolePermissions } from "../src/lib/roles";
import { SettingsPage } from "../src/components/admin/system";
import { uploadFileError, UPLOAD_MB } from "../src/lib/upload-size-policy";

function fixture(permissions: Server["permissions"], superAdmin = false) {
  const server: Server = {
    serverId: "NPB", organizationId: "00000000-0000-4000-8000-000000000001", displayName: "NPU BETA", description: "Test server",
    gameAddress: "beta.example.edu:25565", iconObjectKey: null, mottoImageUrl: null, sortOrder: 3, themeColor: "#123456", isListed: true,
    archivedAt: null, clientArchivedAt: null, currentReleaseId: "00000000-0000-4000-8000-000000000002", currentReleaseActive: true,
    publicationRevision: 1, boundClientId: "00000000-0000-4000-8000-000000000003", boundClientName: "Beta client", permissions,
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
    for (const forbidden of ['name="sortOrder"', 'name="themeColor"', ">标记上架<", 'aria-label="归档管理"']) assert(!html.includes(forbidden), `${role}: ${forbidden}`);
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

test("motto preview uses the reference proportion and a white fade beginning at the golden section", () => {
  const html = renderToStaticMarkup(<MottoPreview src="/api/admin/servers/NPB/motto-image?version=test" alt="Beta 箴言" />);
  assert(html.includes("aspect-ratio:2.652173913043478")); assert(html.includes("transparent 61.8034%, white 100%"));
  assert(html.includes('alt="Beta 箴言"')); assert(html.includes("bg-white"));
  const crop = mottoCrop(610, 400);
  const grid = renderToStaticMarkup(<MottoCropGrid source={{ url: "/image.webp", width: 610, height: 400 }} crop={crop} onChange={() => {}} />);
  assert(grid.includes('viewBox="0 0 610 400"')); assert.equal((grid.match(/<line /g) ?? []).length, 4);
  const selection = grid.match(/<rect\b[^>]*width="([^"]+)"[^>]*height="([^"]+)"/);
  assert(selection); assert(Math.abs(Number(selection[1]) - 610) < 1e-6); assert(Math.abs(Number(selection[2]) - 230) < 1e-6);
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
