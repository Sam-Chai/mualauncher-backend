import { invariant } from "./errors";

/** Shared path rules for imported archives and the MUA distribution protocol. */
export function safePackPath(path: string) {
  invariant(path.length > 0 && path.length <= 1000 && !path.startsWith("/") && !path.includes("\\"), 422, "ZIP 中包含无效路径");
  const segments = path.normalize("NFC").split("/");
  invariant(segments.every(segment => segment && segment !== "." && segment !== ".." && !/[\x00-\x1f\x7f<>:"|?*]/.test(segment) &&
    !/[. ]$/.test(segment) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)), 422, "ZIP 中包含不安全或 Windows 不兼容的路径");
  return segments.join("/");
}
