import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { diagnosticText } from "./diagnostics";
import { invariant } from "./errors";

export const LOGIN_CLIENT_COOKIE = "mua_login_client";
export const LOGIN_CLIENT_SECONDS = 86400;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

// Only opt in when a mandatory proxy strips and overwrites this header. Never
// infer a client address from arbitrary Forwarded / X-Forwarded-For headers.
export function loginClient(request: Request, cookie: string | undefined) {
  const header = process.env.AUTH_CLIENT_IP_HEADER;
  if (header) {
    invariant(/^[a-z0-9-]+$/.test(header), 503, diagnosticText("diagnostics.auth.invalidClientIpConfiguration"));
    const address = request.headers.get(header)?.trim();
    invariant(address && isIP(address) && !address.includes("%"), 400, diagnosticText("diagnostics.auth.invalidClientAddress"));
    // Canonicalize equivalent IPv6 spellings, including IPv4-mapped addresses.
    const normalized = isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname : address;
    return { key: `ip:${digest(normalized)}`, cookie: undefined };
  }
  // A resettable browser identifier is a fallback, not an anti-bot identity.
  // Crucially it cannot spend another browser's or the whole site's quota.
  const browser = cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : randomBytes(32).toString("hex");
  return { key: `browser:${digest(browser)}`, cookie: browser };
}

export function loginQuotas(clientKey: string, username: string) {
  return [
    { key: digest(`login:v2:client:${clientKey}`), limit: 60, seconds: 300 },
    { key: digest(`login:v2:client-user:${clientKey}:${username}`), limit: 10, seconds: 900 },
  ];
}

// Two scrypt calls can already use about 256 MiB. Do not queue unbounded work
// or consume a shared time-window quota that blocks all future valid logins.
export function createLoginWorkLimit(maximum = 2) {
  let active = 0;
  return async <T>(work: () => Promise<T>): Promise<T> => {
    invariant(active < maximum, 429, diagnosticText("diagnostics.auth.tooManySignInAttemptsTryAgainLater"));
    active++;
    try { return await work(); } finally { active--; }
  };
}
const state = globalThis as typeof globalThis & { muaLoginWork?: ReturnType<typeof createLoginWorkLimit> };
export const withLoginWork = state.muaLoginWork ??= createLoginWorkLimit();
