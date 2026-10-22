import { readFile, mkdir, writeFile } from "node:fs/promises";
import { validate } from "@scalar/openapi-parser";
import { publicOpenApi, PUBLIC_OPERATION_IDS } from "../src/lib/openapi/document";
import { apiInventory } from "../src/lib/openapi/inventory";
import { syncRequestContracts } from "./openapi-sources";
import { verifyCoverage } from "./openapi-coverage";
import { checkCompatibility } from "./openapi-compatibility";
import { createHash } from "node:crypto";

async function main() {
  const check = process.argv.includes("--check");
  await syncRequestContracts(check);
  const { adminOpenApi, privateOperations } = await import("../src/lib/openapi/private-document");
  await verifyCoverage([...apiInventory]);
  const outputs = new Map<string, string>();
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const [scope, document] of [["public", publicOpenApi(locale)], ["admin", adminOpenApi(locale)]] as const) {
      const result = await validate(JSON.stringify(document));
      if (!result.valid) throw new Error(JSON.stringify(result.errors));
      const expected = scope === "public" ? PUBLIC_OPERATION_IDS.length : apiInventory.length;
      const count = Object.values(document.paths ?? {}).reduce((sum, path) => sum + ["get", "post", "patch", "put", "delete"].filter(method => path && method in path).length, 0);
      if (count !== expected) throw new Error(`${scope}: expected ${expected} operations, got ${count}`);
      if (locale === "en-US" && /[\u3400-\u9fff]/.test(JSON.stringify(document))) throw new Error(`${scope}: untranslated English document`);
      if (scope === "admin") await verifyCoverage([...apiInventory.filter(item => item.group === "Launcher"), ...privateOperations]);
      if (check && locale === "en-US") await checkCompatibility(document, `docs/openapi/baselines/${scope === "public" ? "public-5.0.0" : "admin-5.0.0"}.json`);
      outputs.set(`docs/openapi/union-link.${scope === "admin" ? "admin." : ""}${locale}.json`, JSON.stringify(document, null, 2) + "\n");
    }
  }
  const sourceFiles = [...new Set(["prisma/migrations/202610220003_union_site_descriptions/migration.sql", "src/lib/union-site-metadata.ts", "prisma/migrations/202610210005_player_role/migration.sql", "prisma/migrations/202610210006_union_player_identity/migration.sql", "prisma/migrations/202610210004_yituem_skin_site_aliases/migration.sql", "prisma/migrations/202610210003_organization_skin_site_read/migration.sql", "src/lib/union-directory.ts", "src/lib/union-directory-contract.ts", "src/lib/union-site-icons.ts", "src/lib/organization-avatar.ts", "src/lib/organization-avatar-contract.ts", "prisma/migrations/202610210002_union_directory_avatars/migration.sql", "src/lib/union-oauth.ts", "src/lib/member-access.ts", "src/lib/organization-access.ts", "src/lib/launcher-auth.ts", "src/lib/union-contract.ts", "prisma/migrations/202610210001_union_member_access/migration.sql", "src/lib/storage-telemetry.ts", "src/lib/storage-telemetry-contract.ts", "src/lib/storage-telemetry-metrics.ts", "src/lib/object-storage/telemetry.ts", "prisma/migrations/202610180001_storage_telemetry/migration.sql", "src/lib/recipe-distribution.ts", "src/lib/recipe-distribution-contract.ts", "src/lib/client-service.ts", "src/lib/management.ts", "src/lib/api-auth.ts", "src/lib/package-build-service.ts", "src/lib/draft-lifecycle.ts", "src/lib/http.ts", "src/lib/input.ts", "src/lib/roles.ts", "src/lib/auth.ts", "src/lib/rbac.ts", "src/lib/database-security.ts", "src/lib/infrastructure.ts", "src/lib/server-motto.ts", "src/lib/server-motto-contract.ts", "src/lib/server-probe-contract.ts", "src/lib/download-settings.ts", "src/lib/upload-size-settings.ts", "src/lib/package-format-settings.ts", "src/lib/recycle-storage.ts", "src/lib/client-contract.ts", "src/lib/package-contract.ts", "src/lib/muapack-v2-contract.ts", "src/lib/muapack-contract.ts", "src/lib/client-download.ts", "src/lib/catalog.ts", "src/app/api/auth/[action]/route.ts", "src/app/api/admin/[...path]/route.ts", "src/app/api/v1/clients/route.ts", "src/app/api/v1/clients/[...path]/route.ts", "src/app/api/admin/servers/[serverId]/motto-image/route.ts", "src/app/api/admin/servers/[serverId]/probe/route.ts", "prisma/migrations/202610140001_initial_release/migration.sql", "prisma/schema.prisma"])].sort();
  sourceFiles.push("src/lib/launcher-game-auth.ts", "src/lib/launcher-game-contract.ts", "src/lib/launcher-game-identity.ts", "src/lib/launcher-game-network.ts", "prisma/migrations/202610220001_launcher_game_exchange/migration.sql");
  sourceFiles.push("prisma/migrations/202610220002_union_login_audit_context/migration.sql", "src/app/api/admin/launcher-providers/route.ts", "src/app/api/auth/launcher/providers/route.ts", "src/app/api/auth/launcher/yggdrasil/start/route.ts", "src/app/api/auth/launcher/yggdrasil/exchange/route.ts");
  sourceFiles.push("src/lib/i18n.ts", "src/lib/locales/zh-CN.json", "src/lib/locales/en-US.json", "src/lib/openapi/document.ts", "src/lib/openapi/private-document.ts", "src/lib/openapi/union-document.ts");
  sourceFiles.push("src/lib/diagnostics.ts", "src/lib/errors.ts", "prisma/migrations/202610220004_english_diagnostic_default/migration.sql");
  sourceFiles.sort();
  outputs.set("docs/openapi/source-manifest.json", JSON.stringify(Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash("sha256").update((await readFile(path, "utf8")).replace(/\r\n/g, "\n")).digest("hex")]))), null, 2) + "\n");
  outputs.set("docs/api-inventory.md", ["# Union Link API 接口清单", "",
    "由 `npm run openapi:generate` 生成。以下为实际业务路径，catch-all 已展开；HEAD／OPTIONS 框架隐式方法不作为独立业务操作。", "",
    `${apiInventory.length} 个业务操作均已纳入受保护的后台完整 OpenAPI；对外规范包含 ${PUBLIC_OPERATION_IDS.length} 个 Launcher 认证及成员读取操作。文档不授予业务权限。`, "",
    "Cookie 写操作要求同源 Origin；Bearer 仅适用于客户端标准 API，并继续检查实时 RBAC。Auth 登录／退出要求同源，改密还要求有效会话。", "",
    "| 方法 | 路径 | 分组 | 认证 | OpenAPI | 实现目录 |", "| --- | --- | --- | --- | --- | --- |",
    ...apiInventory.map(item => `| ${item.method} | \`${item.path}\` | ${item.group} | ${item.authentication} | ${publicOpenApi().paths?.[item.path]?.[item.method.toLowerCase() as "get"] ? "公开及后台规范" : "仅后台规范"} | \`${item.source}\` |`), "",
    `合计 ${apiInventory.length} 个业务操作，均已描述。客户端身份统一为 UUID；上传与生命周期操作仅提供独立客户端标准 API。`, "",
    "文档基础设施：`GET /openapi.json?locale=zh-CN|en-US` 为公开 Launcher 规范；`GET /api/admin/openapi?locale=zh-CN|en-US` 逐请求检查后台 Cookie 会话并返回完整规范。`/admin/api` 内嵌 Scalar 默认完整规范，可切换公开规范。内部契约不得加入公开输出。", "",
    "JSON 请求、异步 S3 分片上传、图片 multipart/form-data 与二进制响应必须分别建模。源包上传完成、导入 READY、审核批准、组包 READY 和发布是不同状态。协议、签名与资源生命周期约束详见既有专题文档。", "",
  ].join("\n"));
  if (!check) await mkdir("docs/openapi", { recursive: true });
  for (const [path, expected] of outputs) {
    if (check) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current.replace(/\r\n/g, "\n") !== expected) throw new Error(`${path} is stale. Run npm run openapi:generate.`);
    } else await writeFile(path, expected, "utf8");
  }
  console.log(`OpenAPI 3.1: public/admin in both locales validated; actual route coverage ${apiInventory.length}/${apiInventory.length}; ${check ? "sources, compatibility and artifacts current" : "artifacts generated"}.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
