import { invariant } from "../errors";
import type { StorageConfiguration, StorageProvider } from "./types";

export function storageConfiguration(env: Record<string, string | undefined> = process.env): StorageConfiguration {
  const selected = (env.OSS_PROVIDER ?? "minio").trim().toLowerCase();
  const aliases: Record<string, StorageProvider> = { minio: "minio", aws: "aws", s3: "s3", ali: "ali", aliyun: "ali", tencent: "tencent", cos: "tencent", huawei: "huawei", obs: "huawei" };
  const provider = Object.hasOwn(aliases, selected) ? aliases[selected] : undefined;
  invariant(provider, 503, "OSS_PROVIDER 必须为 minio、aws、s3、ali、tencent 或 huawei");
  const native = ["ali", "tencent", "huawei"].includes(provider);
  const value = (key: string) => (env[`OSS_${key}`] ?? (native ? undefined : env[`S3_${key}`]))?.trim() || undefined;
  const accessKeyId = value("ACCESS_KEY_ID"), secretAccessKey = value("SECRET_ACCESS_KEY");
  invariant(accessKeyId && secretAccessKey, 503, "对象存储访问密钥未配置");
  const region = value("REGION") ?? (["minio", "s3"].includes(provider) ? "us-east-1" : "");
  invariant(region, 503, "云对象存储需要配置 OSS_REGION");
  let endpoint = value("ENDPOINT");
  if (provider === "ali") endpoint ??= `https://oss-${region.replace(/^oss-/, "")}.aliyuncs.com`;
  if (provider === "huawei") endpoint ??= `https://obs.${region}.myhuaweicloud.com`;
  if (["minio", "s3"].includes(provider)) invariant(endpoint, 503, "对象存储 Endpoint 未配置");
  if (endpoint) {
    let url: URL;
    try { url = new URL(endpoint.replaceAll("{bucket}", "example-bucket")); } catch { throw new Error("OSS_ENDPOINT 必须为有效的 HTTP(S) 地址"); }
    invariant(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname), 503, "OSS_ENDPOINT 必须为不含凭据或路径的 HTTP(S) 地址");
    invariant(provider !== "tencent" || endpoint.includes("{bucket}"), 503, "腾讯云自定义 OSS_ENDPOINT 须含 {bucket}；使用默认域名时留空");
    invariant(native || !endpoint.includes("{bucket}"), 503, "S3 Endpoint 不使用 {bucket} 模板，请由 SDK 添加桶名");
  }
  const boolean = (name: string, fallback: boolean) => {
    const raw = env[name]?.trim().toLowerCase();
    invariant(raw === undefined || raw === "" || ["true", "false"].includes(raw), 503, `${name} 必须为 true 或 false`);
    return raw ? raw === "true" : fallback;
  };
  const forcePathStyle = boolean("OSS_FORCE_PATH_STYLE", provider === "minio" || provider === "s3");
  invariant(!["ali", "tencent", "huawei"].includes(provider) || !forcePathStyle, 503, "云存储原生 SDK 不支持 OSS_FORCE_PATH_STYLE=true");
  const customDomain = boolean("OSS_CUSTOM_DOMAIN", false);
  invariant(!customDomain || (!!endpoint && endpoint.includes("{bucket}") && ["ali", "huawei"].includes(provider)), 503, "OSS_CUSTOM_DOMAIN 仅用于 ali/huawei，Endpoint 须含 {bucket} 以区分三个存储桶");
  return { provider, endpoint, region, accessKeyId, secretAccessKey, sessionToken: value("SESSION_TOKEN"), forcePathStyle, customDomain };
}

export const storageBucket = (kind: "PACKAGES" | "CAS" | "ENVIRONMENTS") =>
  process.env[`OSS_${kind}_BUCKET`] ?? process.env[`S3_${kind}_BUCKET`] ?? `mua-${kind.toLowerCase()}`;
