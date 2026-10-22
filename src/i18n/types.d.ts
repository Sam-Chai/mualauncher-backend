import messages from "../lib/locales/zh-CN.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "zh-CN" | "en-US";
    Messages: typeof messages;
  }
}
