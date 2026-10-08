// A credential change is a boundary between two sets of client-side data.
export const AUTH_CHANGE_KEY = "mua-auth-change";
export function navigateAfterAuthChange(path: "/admin" | "/login") {
  try { window.localStorage.setItem(AUTH_CHANGE_KEY, crypto.randomUUID()); }
  catch { /* Storage can be unavailable in restricted browser modes. */ }
  window.location.replace(path);
}
