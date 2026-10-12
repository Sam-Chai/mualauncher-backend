import "server-only";
import { invariant } from "./errors";
import { remoteSourceUrl } from "./remote-download";
import type { DownloadSettings } from "./download-settings";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS, MINECRAFT_SOURCES, JAVA_SOURCES } from "./download-sources";
const hosts = new Set(["piston-meta.mojang.com", "piston-data.mojang.com", "launchermeta.mojang.com", "launcher.mojang.com",
  "libraries.minecraft.net", "resources.download.minecraft.net", "meta.fabricmc.net", "maven.fabricmc.net",
  "meta.quiltmc.org", "maven.quiltmc.org", "repo.maven.apache.org", "maven.minecraftforge.net", "maven.neoforged.net", "api.adoptium.net", "github.com",
  "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
export function trustedEnvironmentUrl(value: string) {
  const url = new URL(value);
  invariant(url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password && !url.hash && hosts.has(url.hostname), 422, "环境下载地址不在官方来源白名单中");
  return url;
}
export type EnvironmentCandidate = { url: string; source: string; mirror: boolean; proxy: boolean; category: string };
export type EnvironmentSettings = Pick<DownloadSettings, "downloadProxyEnabled" | "downloadProxyUrl"> & typeof DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS;
// University mirrors expose a static Maven tree, not the BMCLAPI API root.
export function environmentCandidates(value: string, settings: EnvironmentSettings): EnvironmentCandidate[] {
  const original = trustedEnvironmentUrl(value); const candidates: EnvironmentCandidate[] = [];
  const add = (url: string, source: string, category: string) => candidates.push({ url, source, category, mirror: true, proxy: settings.downloadProxyEnabled && settings.mirrorProxyEnabled });
  const host = original.hostname, path = original.pathname;
  const metadata = ["piston-meta.mojang.com", "piston-data.mojang.com", "launchermeta.mojang.com", "launcher.mojang.com"].includes(host);
  const maven = ["libraries.minecraft.net", "maven.fabricmc.net", "repo.maven.apache.org", "maven.quiltmc.org", "maven.minecraftforge.net", "maven.neoforged.net"].includes(host);
  const mavenPath = host === "repo.maven.apache.org" ? path.replace(/^\/maven2\//, "/") : host === "maven.quiltmc.org" ? path.replace(/^\/repository\/release\//, "/") : host === "maven.neoforged.net" ? path.replace(/^\/releases\//, "/") : path;
  for (const source of settings.minecraftDownloadSources) {
    const base = MINECRAFT_SOURCES.find(item => item.value === source)!.url;
    if (source === "bmclapi") {
      const mapped = metadata ? path : host === "resources.download.minecraft.net" ? `/assets${path}` : maven ? `/maven${mavenPath}` :
        host === "meta.fabricmc.net" ? `/fabric-meta${path}` : host === "meta.quiltmc.org" ? `/quilt-meta${path}` : null;
      if (mapped) add(`${base}${mapped}${original.search}`, source, metadata ? "minecraft" : maven ? "maven" : host);
    } else if (maven) add(`${base}${mavenPath}${original.search}`, source, "maven");
    // Their assets/ directory is a Maven coordinate, not Mojang's hash asset tree.
  }
  if (settings.javaDownloadSources.includes("tuna") && host === "github.com") {
    const match = /^\/adoptium\/temurin(\d+)-binaries\/releases\/download\/[^/]+\/(OpenJDK\d+U-(jre|jdk)_(x64|aarch64)_(windows|linux|mac)_hotspot_[A-Za-z0-9._-]+\.(?:zip|tar\.gz))$/.exec(path);
    if (match) add(`${JAVA_SOURCES[0].url}/${match[1]}/${match[3]}/${match[4]}/${match[5]}/${match[2]}`, "tuna", "java");
  }
  candidates.push({ url: original.href, source: "official", mirror: false, proxy: settings.downloadProxyEnabled, category: host });
  return candidates;
}
export function environmentCandidateUrl(value: string, candidate: EnvironmentCandidate, settings: EnvironmentSettings) {
  const network: DownloadSettings = { ...settings, remoteSourceWhitelistEnabled: false, remoteSourceHosts: [], downloadProxyEnabled: candidate.proxy };
  const url = remoteSourceUrl(value, network);
  // BMCLAPI assigns public CDN nodes dynamically. Public DNS pinning, TLS and
  // payload verification still apply to every node.
  if (candidate.source === "bmclapi") return url;
  if (hosts.has(url.hostname)) return trustedEnvironmentUrl(value);
  const mirror = [...MINECRAFT_SOURCES, ...JAVA_SOURCES].find(item => new URL(item.url).hostname === url.hostname);
  invariant(candidate.mirror && mirror && url.pathname.startsWith(new URL(mirror.url).pathname + "/"), 422, "环境重定向不在受信来源中");
  return url;
}
