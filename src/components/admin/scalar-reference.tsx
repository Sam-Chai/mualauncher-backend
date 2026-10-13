"use client";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { useMemo } from "react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/preferences";
import styles from "./scalar-reference.module.css";

export function ScalarReference() {
  const { locale, t } = useI18n();
  const { resolvedTheme } = useTheme();
  const configuration = useMemo(() => ({
    sources: [{ title: t("后台完整接口"), slug: "admin", default: true, url: `/api/admin/openapi?locale=${locale}` },
      { title: t("Launcher 公开接口"), slug: "launcher", url: `/openapi.json?locale=${locale}` }],
    // Scalar's request builder otherwise concatenates the root '/' with '/api/...' as '//api/...'.
    servers: [{ url: window.location.origin }],
    localization: { locale: locale === "en-US" ? "en" : "zh-CN" },
    forceDarkModeState: resolvedTheme === "dark" ? "dark" as const : "light" as const,
    hideDarkModeToggle: true, withDefaultFonts: false, hideClientButton: true,
    showDeveloperTools: "never" as const, showToolbar: "never" as const, agent: { disabled: true },
    persistAuth: false, telemetry: false,
    customFetch: (input: string | URL | Request, init?: RequestInit) => {
      // Scalar sends a Request object; replacing its headers with an empty init drops JSON/Bearer headers.
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      // Origin is documented for non-browser callers, but browsers set this forbidden header themselves.
      headers.delete("Origin");
      return window.fetch(input, { ...init, headers, credentials: "same-origin" });
    },
  }), [locale, resolvedTheme, t]);
  return <div className={`${styles.reference} min-w-0 overflow-hidden rounded-lg border`}>
    <ApiReferenceReact key={locale} configuration={configuration} />
  </div>;
}
