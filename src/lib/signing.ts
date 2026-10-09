import "server-only";
import { readFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { digest } from "./storage";
import { invariant } from "./errors";

export async function signingIdentity() {
  invariant(process.env.SIGNING_PRIVATE_KEY_PATH, 503, "发布签名密钥未配置");
  const privateKey = createPrivateKey(await readFile(process.env.SIGNING_PRIVATE_KEY_PATH));
  invariant(privateKey.asymmetricKeyType === "ed25519", 503, "发布密钥必须是 Ed25519");
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { privateKey, keyId: digest(publicKey).slice(0, 24), publicKey: publicKey.toString("base64") };
}
export async function signManifest(bytes: Buffer) {
  const identity = await signingIdentity();
  const signature = sign(null, bytes, identity.privateKey).toString("base64");
  invariant(verify(null, bytes, createPublicKey(identity.privateKey), Buffer.from(signature, "base64")), 500, "Manifest 签名校验失败");
  return { keyId: identity.keyId, signature };
}
