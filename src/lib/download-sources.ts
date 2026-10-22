// Shared, serializable settings options; no server-only imports in this module.
export const MINECRAFT_SOURCES = [
  { value: "bmclapi", label: "BMCLAPI", url: "https://bmclapi2.bangbang93.com", documentation: "https://bmclapidoc.bangbang93.com/" },
  { value: "ustc", label: "downloadSources.universityOfScienceAndTechnologyOfChina", url: "https://mirrors.ustc.edu.cn/bmclapi" },
  { value: "nju", label: "downloadSources.nanjingUniversity", url: "https://mirrors.nju.edu.cn/bmclapi" },
] as const;
export const DEFAULT_MINECRAFT_SOURCES = ["bmclapi", "ustc", "nju"] as const;
export const JAVA_SOURCES = [{ value: "tuna", label: "downloadSources.tsinghuaTunaAdoptium", url: "https://mirrors.tuna.tsinghua.edu.cn/Adoptium" }] as const;
export type MinecraftSource = typeof MINECRAFT_SOURCES[number]["value"];
export type JavaSource = typeof JAVA_SOURCES[number]["value"];
export type EnvironmentDownloadSettings = { minecraftDownloadSources: MinecraftSource[]; javaDownloadSources: JavaSource[]; mirrorProxyEnabled: boolean; javaImageType: "jre" | "jdk" };
export const DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS: EnvironmentDownloadSettings = {
  minecraftDownloadSources: [...DEFAULT_MINECRAFT_SOURCES], javaDownloadSources: ["tuna"], mirrorProxyEnabled: false, javaImageType: "jre",
};
