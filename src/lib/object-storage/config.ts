import { diagnosticText } from "@/lib/diagnostics";
import { invariant } from "../errors";
import type { StorageConfiguration, StorageProvider } from "./types";

export function storageConfiguration(env: Record<string, string | undefined> = process.env): StorageConfiguration {
  const selected = (env.OSS_PROVIDER ?? "minio").trim().toLowerCase();
  const aliases: Record<string, StorageProvider> = { minio: "minio", aws: "aws", s3: "s3", ali: "ali", aliyun: "ali", tencent: "tencent", cos: "tencent", huawei: "huawei", obs: "huawei" };
  const provider = Object.hasOwn(aliases, selected) ? aliases[selected] : undefined;
  invariant(provider, 503, diagnosticText("diagnostics.config.ossProviderMustBeMinioAwsS3AliTencentOr"));
  const native = ["ali", "tencent", "huawei"].includes(provider);
  const value = (key: string) => (env[`OSS_${key}`] ?? (native ? undefined : env[`S3_${key}`]))?.trim() || undefined;
  const accessKeyId = value("ACCESS_KEY_ID"), secretAccessKey = value("SECRET_ACCESS_KEY");
  invariant(accessKeyId && secretAccessKey, 503, diagnosticText("diagnostics.config.objectStorageAccessCredentialsAreNotConfigured"));
  const region = value("REGION") ?? (["minio", "s3"].includes(provider) ? "us-east-1" : "");
  invariant(region, 503, diagnosticText("diagnostics.config.cloudObjectStorageRequiresOssRegion"));
  let endpoint = value("ENDPOINT");
  if (provider === "ali") endpoint ??= `https://oss-${region.replace(/^oss-/, "")}.aliyuncs.com`;
  if (provider === "huawei") endpoint ??= `https://obs.${region}.myhuaweicloud.com`;
  if (["minio", "s3"].includes(provider)) invariant(endpoint, 503, diagnosticText("diagnostics.config.theObjectStorageEndpointIsNotConfigured"));
  if (endpoint) {
    let url: URL;
    try { url = new URL(endpoint.replaceAll("{bucket}", "example-bucket")); } catch { throw new Error(diagnosticText("diagnostics.config.ossEndpointMustBeAValidHttpSUrl")); }
    invariant(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname), 503, diagnosticText("diagnostics.config.ossEndpointMustBeAnHttpSUrlWithoutCredentials"));
    invariant(provider !== "tencent" || endpoint.includes("{bucket}"), 503, diagnosticText("diagnostics.config.aCustomTencentOssEndpointMustContainBucketLeaveIt"));
    invariant(native || !endpoint.includes("{bucket}"), 503, diagnosticText("diagnostics.config.s3EndpointsMustNotUseABucketTemplateTheSdk"));
  }
  const boolean = (name: string, fallback: boolean) => {
    const raw = env[name]?.trim().toLowerCase();
    invariant(raw === undefined || raw === "" || ["true", "false"].includes(raw), 503, diagnosticText("diagnostics.config.0MustBeTrueOrFalse", { arg0: name }));
    return raw ? raw === "true" : fallback;
  };
  const forcePathStyle = boolean("OSS_FORCE_PATH_STYLE", provider === "minio" || provider === "s3");
  invariant(!["ali", "tencent", "huawei"].includes(provider) || !forcePathStyle, 503, diagnosticText("diagnostics.config.nativeCloudStorageSdksDoNotSupportOssForcePath"));
  const customDomain = boolean("OSS_CUSTOM_DOMAIN", false);
  invariant(!customDomain || (!!endpoint && endpoint.includes("{bucket}") && ["ali", "huawei"].includes(provider)), 503, diagnosticText("diagnostics.config.ossCustomDomainIsOnlySupportedForAliHuaweiThe"));
  return { provider, endpoint, region, accessKeyId, secretAccessKey, sessionToken: value("SESSION_TOKEN"), forcePathStyle, customDomain };
}

export const storageBucket = (kind: "PACKAGES" | "CAS" | "ENVIRONMENTS") =>
  process.env[`OSS_${kind}_BUCKET`] ?? process.env[`S3_${kind}_BUCKET`] ?? `mua-${kind.toLowerCase()}`;
