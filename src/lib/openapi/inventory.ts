type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Entry = readonly [Method, string];
const publicSource = "src/app/api/v1/servers";
export const apiInventory = [
  ...([ ["GET", "/api/v1/servers"], ["GET", "/api/v1/servers/{serverId}/manifest"],
    ["GET", "/api/v1/servers/{serverId}/packages"],
    ["GET", "/api/v1/servers/{serverId}/releases/{releaseId}/packages"] ] satisfies Entry[])
    .map(([method, path]) => ({ method, path, group: "Launcher", authentication: "public", documented: true, source: publicSource })),
  ...([ ["GET", "/api/v1/clients"], ["POST", "/api/v1/clients"], ["GET", "/api/v1/clients/{clientId}"],
    ["POST", "/api/v1/clients/{clientId}/bind"], ["POST", "/api/v1/clients/{clientId}/unbind"],
    ["POST", "/api/v1/clients/{clientId}/archive"], ["POST", "/api/v1/clients/{clientId}/delete"],
    ["POST", "/api/v1/clients/uploads"], ["GET", "/api/v1/clients/uploads/{uploadId}"],
    ["GET", "/api/v1/clients/uploads/{uploadId}/distribution-statistics"],
    ["GET", "/api/v1/clients/{clientId}/drafts/{draftId}/distribution-statistics"],
    ["GET", "/api/v1/clients/{clientId}/releases/{releaseId}/distribution-statistics"],
    ...["parts", "complete", "submit", "retry", "cancel", "select-instance"].map(action => ["POST", `/api/v1/clients/uploads/{uploadId}/${action}`] as const),
    ...["manifest", "platform-manifest", "package"].map(action => ["GET", `/api/v1/clients/{clientId}/drafts/{draftId}/${action}`] as const),
    ...["archive", "platforms", "retry-packages", "review", "publish"].map(action => ["POST", `/api/v1/clients/{clientId}/drafts/{draftId}/${action}`] as const),
    ["GET", "/api/v1/clients/{clientId}/releases/{releaseId}/package"], ["POST", "/api/v1/clients/{clientId}/releases/{releaseId}/activate"],
  ] satisfies Entry[]).map(([method, path]) => ({ method, path, group: "Clients", authentication: "session OR bearer", documented: true, source: "src/app/api/v1/clients" })),
  ...([ ...["state", "pipeline", "tokens", "recycle-settings", "download-settings", "package-format-settings", "upload-size-settings"].map(action => ["GET", `/api/admin/${action}`] as const),
    ["GET", "/api/admin/organizations/{organizationId}/account-search"],
    ["POST", "/api/admin/tokens"], ["POST", "/api/admin/tokens/{tokenId}/revoke"],
    ...["organizations", "servers", "accounts"].map(kind => ["POST", `/api/admin/${kind}`] as const),
    ["PATCH", "/api/admin/organizations/{organizationId}"], ["PATCH", "/api/admin/servers/{serverId}"], ["PATCH", "/api/admin/accounts/{accountId}"],
    ["POST", "/api/admin/organizations/{organizationId}/archive"], ["POST", "/api/admin/servers/{serverId}/archive"],
    ["PUT", "/api/admin/organizations/{organizationId}/members/{accountId}"], ["PUT", "/api/admin/organizations/{organizationId}/members/{accountId}/servers/{serverId}"],
    ...["recycle-settings", "download-settings", "package-format-settings", "upload-size-settings"].map(action => ["PATCH", `/api/admin/${action}`] as const),
    ["GET", "/api/admin/servers/{serverId}/probe"],
    ...["GET", "POST", "DELETE"].map(method => [method, "/api/admin/servers/{serverId}/motto-image"] as Entry),
  ] satisfies Entry[]).map(([method, path]) => ({ method, path, group: "Admin", authentication: "session", documented: true, source: "src/app/api/admin" })),
  ...["login", "logout", "password"].map(action => ({ method: "POST" as const, path: `/api/auth/${action}`, group: "Auth",
    authentication: action === "password" ? "session + same-origin" : "same-origin", documented: true, source: "src/app/api/auth/[action]/route.ts" })),
];
