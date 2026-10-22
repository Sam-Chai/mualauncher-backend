// next-intl's framework-independent core also runs in Worker/CLI processes.
import { createTranslator } from "use-intl/core";
import chinese from "./locales/zh-CN.json";
import english from "./locales/en-US.json";

export const LOCALE_COOKIE = "mua-locale";
export const messages = { "zh-CN": chinese, "en-US": english };
export type Locale = keyof typeof messages;
type LeafKeys<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}` }[keyof T & string];
export type MessageKey = LeafKeys<typeof chinese>;
export type Translate = (key: string, values?: Record<string, unknown>) => string;
export const parseLocale = (value: unknown): Locale => value === "en-US" ? "en-US" : "zh-CN";

/** Shared controls may receive either a message key or an already rendered label. */
export function hasMessage(key: string): key is MessageKey {
  return typeof key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, chinese) === "string";
}
export const messageValues = (values: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "number" || typeof value === "string" ? value : String(value ?? "")]));
const translators = {
  "zh-CN": createTranslator({ locale: "zh-CN", messages: chinese }),
  "en-US": createTranslator({ locale: "en-US", messages: english }),
};
export const translator = (locale: Locale): Translate => (key, values) => hasMessage(key) ? translators[locale](key, messageValues(values)) : key;
export const translate = (locale: Locale, key: string, values?: Record<string, unknown>) => translator(locale)(key, values);
export const localizedDate = (value: unknown, locale: Locale) => new Date(String(value)).toLocaleString(locale, { timeZone: "Asia/Shanghai", hour12: false });
