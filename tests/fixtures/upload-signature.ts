import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Recalculate the signature using the headers actually received by the HTTP
// fixture, rather than trusting the URL's declaration that length is signed.
export function validUploadSignature(provider: "ali" | "tencent" | "huawei" | "aws", url: URL, headers: Record<string, string>, bucket: string, secret = "test-secret") {
  if (provider === "ali") {
    const additional = url.searchParams.get("x-oss-additional-headers")?.split(";") ?? [];
    if (!additional.includes("content-length") || !headers["content-length"]) return false;
    const queries = Object.fromEntries(url.searchParams); delete queries["x-oss-signature"];
    const signer = require("ali-oss/lib/common/signUtils") as {
      getCanonicalRequest(method: string, request: unknown, bucket: string, key: string, additional: string[]): string;
      getStringToSign(region: string, date: string, canonical: string): string;
      getSignatureV4(secret: string, day: string, region: string, value: string): string;
    };
    const date = queries["x-oss-date"], region = queries["x-oss-credential"].split("/")[2];
    const canonical = signer.getCanonicalRequest("PUT", { headers, queries }, bucket, decodeURIComponent(url.pathname.slice(1)), additional);
    return signer.getSignatureV4(secret, date.slice(0, 8), region, signer.getStringToSign(region, date, canonical)) === url.searchParams.get("x-oss-signature");
  }
  if (provider === "tencent") {
    const names = url.searchParams.get("q-header-list")?.split(";") ?? [];
    if (!names.includes("content-length") || !headers["content-length"]) return false;
    const { getAuth } = require("cos-nodejs-sdk-v5/sdk/util") as { getAuth(options: unknown): string };
    const signature = getAuth({ SecretId: "test-id", SecretKey: secret, Method: "PUT", Key: decodeURIComponent(url.pathname),
      Headers: Object.fromEntries(names.map(name => [name, headers[name]])), KeyTime: url.searchParams.get("q-key-time"),
      Query: Object.fromEntries([...url.searchParams].filter(([name]) => !name.startsWith("q-"))) });
    return new URLSearchParams(signature).get("q-signature") === url.searchParams.get("q-signature");
  }
  const names = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
  if (!names.includes("content-length") || !headers["content-length"]) return false;
  const query = [...url.searchParams].filter(([key]) => key !== "X-Amz-Signature").map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("&");
  const canonicalHeaders = names.map(name => `${name}:${headers[name]?.trim().replace(/\s+/g, " ")}\n`).join("");
  const canonical = `PUT\n${url.pathname}\n${query}\n${canonicalHeaders}\n${names.join(";")}\nUNSIGNED-PAYLOAD`;
  const [, day, region, service, terminator] = url.searchParams.get("X-Amz-Credential")!.split("/");
  const scope = `${day}/${region}/${service}/${terminator}`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), terminator);
  return hmac(key, `AWS4-HMAC-SHA256\n${url.searchParams.get("X-Amz-Date")}\n${scope}\n${sha(canonical)}`).toString("hex") === url.searchParams.get("X-Amz-Signature");
}
