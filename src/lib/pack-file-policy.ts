import { diagnosticText } from "./diagnostics";
import { invariant } from "./errors";

const privateDirectories = new Set([".mua", ".unionlink", ".launcher", ".hmcl", "pcl", ".git", ".svn", ".hg", ".ssh", ".aws", ".azure", ".gnupg"]);
const accountFile = /^(?:(?:accounts|user-accounts|account-private-data|user-account-private-data|launcher_accounts(?:_microsoft_store)?|launcher_profiles(?:_microsoft_store)?|hmcl_accounts|hmcl|usercache|usernamecache)\.json|launcher_msa_credentials\.bin)(?:$|[.~_-])/;

/** Path policy only: arbitrary mod configuration contents are not inspected. */
export function sensitivePackPath(path: string): boolean {
  const parts = path.normalize("NFC").toLowerCase().split("/");
  // The chosen instance identifier is user-defined (e.g. versions/pcl), not a private directory.
  const contentParts = parts[0] === "versions" && parts.length > 2 ? parts.slice(2) : parts;
  if (contentParts.some(part => privateDirectories.has(part))) return true;
  const name = parts.at(-1)!;
  return accountFile.test(name) || /^\.env(?:$|[.~_-])/.test(name) || /^(?:\.npmrc|\.pypirc|\.netrc|_netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:$|[.~_-])/.test(name);
}

/** Apply to new publications, without changing readers for signed historical packages. */
export function assertDistributableFiles(files: readonly { path: string; root?: string }[]) {
  invariant(!files.some(file => (!file.root || file.root === "instance") && sensitivePackPath(file.path)), 422,
    diagnosticText("diagnostics.packPolicy.sensitiveFilesBlocked"));
}
