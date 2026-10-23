import assert from "node:assert/strict";
import { test } from "node:test";
import { loginClient, loginQuotas, createLoginWorkLimit } from "../src/lib/login-policy";
import { AppError } from "../src/lib/errors";

test("browser quotas ignore spoofed forwarding headers and cannot spend another client's budget", () => {
  const previous = process.env.AUTH_CLIENT_IP_HEADER; delete process.env.AUTH_CLIENT_IP_HEADER;
  try {
    const request = new Request("http://localhost/api/auth/login", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const first = loginClient(request, undefined), second = loginClient(request, undefined);
    assert.match(first.cookie!, /^[a-f0-9]{64}$/); assert.notEqual(first.key, second.key);
    assert.equal(loginClient(request, first.cookie).key, first.key);
    assert.notEqual(loginClient(request, "attacker-controlled-invalid-cookie").key, first.key);
    assert(loginQuotas(first.key, "same-user").every((quota, i) => quota.key !== loginQuotas(second.key, "same-user")[i].key));
    assert(loginQuotas(first.key, "name-a")[0].key === loginQuotas(first.key, "name-b")[0].key);
  } finally { if (previous === undefined) delete process.env.AUTH_CLIENT_IP_HEADER; else process.env.AUTH_CLIENT_IP_HEADER = previous; }
});

test("trusted proxy configuration fails closed on missing, multiple or invalid client addresses", () => {
  const previous = process.env.AUTH_CLIENT_IP_HEADER; process.env.AUTH_CLIENT_IP_HEADER = "x-client-ip";
  try {
    const request = (value?: string) => new Request("http://localhost/api/auth/login", { headers: value ? { "x-client-ip": value } : {} });
    for (const value of [undefined, "invalid", "203.0.113.1, 203.0.113.2", "fe80::1%eth0"]) assert.throws(() => loginClient(request(value), "a".repeat(64)), (e: unknown) => e instanceof AppError && e.status === 400);
    assert.equal(loginClient(request("2001:db8::1"), undefined).key, loginClient(request("2001:0db8:0:0:0:0:0:1"), undefined).key);
    assert.equal(loginClient(request("203.0.113.1"), "a".repeat(64)).cookie, undefined);
    assert.equal(loginClient(request("203.0.113.1"), "a".repeat(64)).key, loginClient(request("203.0.113.1"), "b".repeat(64)).key);
    process.env.AUTH_CLIENT_IP_HEADER = "X-Unsafe-Config";
    assert.throws(() => loginClient(request("203.0.113.1"), undefined), (e: unknown) => e instanceof AppError && e.status === 503);
  } finally { if (previous === undefined) delete process.env.AUTH_CLIENT_IP_HEADER; else process.env.AUTH_CLIENT_IP_HEADER = previous; }
});

test("password work rejects excess concurrency and releases admission after success or failure", async () => {
  const limited = createLoginWorkLimit(1);
  let release!: () => void;
  const first = limited(() => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(limited(async () => assert.fail("excess work must not start")), (e: unknown) => e instanceof AppError && e.status === 429);
  release(); await first;
  await assert.rejects(limited(async () => { throw new Error("verification failed"); }), /verification failed/);
  assert.equal(await limited(async () => "valid login admitted"), "valid login admitted");
});
