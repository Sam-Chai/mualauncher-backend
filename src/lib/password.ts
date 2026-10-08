import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt);
  return `scrypt:131072:8:1:${salt}:${hash.toString("hex")}`;
}

// Same work for an unknown username; this value never authenticates an account.
export const dummyHash = `scrypt:131072:8:1:${"0".repeat(32)}:${"0".repeat(128)}`;
export async function verifyPassword(password: string, encoded: string) {
  if (!/^scrypt:131072:8:1:[0-9a-f]{32}:[0-9a-f]{128}$/.test(encoded)) return false;
  const parts = encoded.split(":");
  const key = await derive(password, parts[4]);
  return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
}
