import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";

// Copy the actual Zod request expressions, without importing server-only services.
// The generated module is pure and can be checked/built without database credentials.
const requests = [
  ["src/lib/client-service.ts", "uploadInput", "CreateUpload"],
  ...([ ["createClient", "CreateClient"], ["uploadPartUrl", "UploadPart"], ["prepareCompletion", "CompleteUpload"],
    ["selectUploadInstance", "SelectInstance"], ["reviewClient", "ReviewDraft"], ["publishClient", "PublishDraft"],
    ["archiveClientDraft", "ArchiveDraft"], ["activateClient", "ActivateRelease"], ["bindClient", "BindClient"], ["unbindClient", "UnbindClient"] ]
    .map(([fn, name]) => ["src/lib/client-service.ts", fn, name])),
  ["src/lib/api-auth.ts", "createApiToken", "CreateToken"],
  ["src/lib/recycle-storage.ts", "updateRecycleSettings", "RecycleSettings"],
  ["src/lib/upload-size-settings.ts", "updateUploadSizeSettings", "UploadSizeSettings"],
  ["src/lib/package-format-settings.ts", "updatePackageFormatSettings", "PackageFormatSettings"],
  ["src/lib/download-settings.ts", "host", "host"],
  ["src/lib/download-settings.ts", "downloadSettingsSchema", "DownloadSettings"],
] as const;

export async function requestContractSource(overrides: Record<string, string> = {}) {
  const cache = new Map<string, ts.SourceFile>();
  const definitions: string[] = [];
  for (const [path, name, exported] of requests) {
    let file = cache.get(path);
    if (!file) { file = ts.createSourceFile(path, overrides[path] ?? await readFile(path, "utf8"), ts.ScriptTarget.Latest, true); cache.set(path, file); }
    let owner: ts.Node | undefined, expression: ts.Expression | undefined;
    const findOwner = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) { owner = node; expression = node.initializer; }
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) owner = node;
      ts.forEachChild(node, findOwner);
    };
    findOwner(file);
    if (!owner) throw new Error(`Missing request source: ${path}:${name}`);
    if (!expression) {
      const findSchema = (node: ts.Node) => {
        if (expression) return;
        if (ts.isCallExpression(node) && node.expression.getText(file) === "z.object") {
          let schema: ts.Expression = node;
          while (ts.isPropertyAccessExpression(schema.parent) && ts.isCallExpression(schema.parent.parent) && !["safeParse", "parse"].includes(schema.parent.name.text)) schema = schema.parent.parent;
          expression = schema; return;
        }
        ts.forEachChild(node, findSchema);
      };
      findSchema(owner);
    }
    if (!expression) throw new Error(`No Zod request expression: ${path}:${name}`);
    definitions.push(`// ${path}:${name}\nexport const ${exported} = ${expression.getText(file).replace(/\r\n/g, "\n")};`);
  }
  return ["// Generated from actual service validators by npm run openapi:generate. Do not edit.",
    'import { z } from "zod";', 'import { packageFormatVersionSchema } from "../client-contract";',
    'import { MAX_UPLOAD_SIZE_MB, UPLOAD_MB, maxUploadSizeMbSchema } from "../upload-size-policy";',
    'import { enabledPackageFormatsSchema } from "../package-format-policy";',
    'import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "../download-sources";', ...definitions, ""].join("\n\n");
}

export async function syncRequestContracts(check: boolean) {
  const path = "src/lib/openapi/requests.generated.ts", expected = await requestContractSource();
  if (check) {
    if ((await readFile(path, "utf8")).replace(/\r\n/g, "\n") !== expected) throw new Error("Request contracts drifted. Run npm run openapi:generate and review the API compatibility change.");
  } else await writeFile(path, expected);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/openapi-sources.ts")) {
  void syncRequestContracts(process.argv.includes("--check")).catch(error => { console.error(error); process.exitCode = 1; });
}
