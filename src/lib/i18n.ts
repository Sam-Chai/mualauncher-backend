import english from "./locales/en.json";
import extra from "./locales/extra-en.json";
import openapi from "./locales/openapi-en.json";

export const LOCALE_COOKIE = "mua-locale";
export type Locale = "zh-CN" | "en-US";
export type Translate = (message: string, values?: Record<string, unknown>) => string;
export const parseLocale = (value: unknown): Locale => value === "en-US" ? "en-US" : "zh-CN";
const zhNavigation: Record<string, string> = {
  Organization: "组织管理", Server: "服务器", Client: "客户端", Releases: "版本发布", System: "系统管理", Members: "成员管理", Permissions: "权限管理",
  Storage: "存储", Worker: "任务处理", "Signing Keys": "签名密钥", "Audit Log": "审计日志", Settings: "设置",
};
const enMessages: Record<string, string> = { ...english, ...extra, ...openapi };
const reverseMessages = Object.fromEntries(Object.entries(enMessages).map(([key, value]) => [value, key]));
const patterns = Object.entries(enMessages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  regex: new RegExp("^" + key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? "(.+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$"),
  value, tokens: key.match(/\{\d+\}/g)!,
}));
export function translate(locale: Locale, message: string, values: Record<string, unknown> = {}): string {
  const key = message.replace(/\s+/g, " ").trim();
  let result = locale === "en-US" ? enMessages[key] : zhNavigation[key] ?? reverseMessages[key];
  if (!result && locale === "en-US" && /[\u3400-\u9fff]/.test(key)) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(key);
      if (match) {
        const captures = Object.fromEntries(pattern.tokens.map((token, index) => [token, match[index + 1]]));
        result = pattern.value.replace(/\{\d+\}/g, token => captures[token] ?? token);
        break;
      }
    }
  }
  if (result !== undefined) result = (message.match(/^\s*/)?.[0] ?? "") + result + (message.match(/\s*$/)?.[0] ?? "");
  return (result ?? message).replace(/\{([^{}]+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
}
export const translator = (locale: Locale): Translate => (message, values) => translate(locale, message, values);
export const localizedDate = (value: unknown, locale: Locale) => new Date(String(value)).toLocaleString(locale, { timeZone: "Asia/Shanghai", hour12: false });
