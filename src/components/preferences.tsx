"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { Languages, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LOCALE_COOKIE, localizedDate, parseLocale, translator, messages, hasMessage, messageValues, type Locale, type Translate } from "@/lib/i18n";
import { useHydrated } from "@/components/use-hydrated";

type Preferences = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate; formatDate: (value: unknown) => string };
const PreferencesContext = createContext<Preferences>({ locale: "zh-CN", setLocale: () => {}, t: translator("zh-CN"), formatDate: value => localizedDate(value, "zh-CN") });
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="class" storageKey="mua-theme" themes={["light", "dark"]} defaultTheme="light" enableSystem={false} disableTransitionOnChange>{children}</ThemeProvider>;
}
export function PreferenceProvider({ initialLocale = "zh-CN", withTheme = true, children }: { initialLocale?: Locale; withTheme?: boolean; children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    const value = parseLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try { localStorage.setItem(LOCALE_COOKIE, value); } catch {}
    document.documentElement.lang = value;
    setLocaleState(value);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    const onStorage = (event: StorageEvent) => { if (event.key === LOCALE_COOKIE) setLocaleState(parseLocale(event.newValue)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [locale]);
  return <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Shanghai"><PreferenceContextBridge locale={locale} setLocale={setLocale}>{withTheme ? <AppThemeProvider>{children}</AppThemeProvider> : children}</PreferenceContextBridge></NextIntlClientProvider>;
}
function PreferenceContextBridge({ locale, setLocale, children }: { locale: Locale; setLocale: (locale: Locale) => void; children: ReactNode }) {
  const intl = useTranslations();
  const value = useMemo(() => ({ locale, setLocale, t: ((key, values) => hasMessage(key) ? intl(key, messageValues(values)) : key) as Translate, formatDate: (date: unknown) => localizedDate(date, locale) }), [intl, locale, setLocale]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export const useI18n = () => useContext(PreferencesContext);

export function PreferenceControls() {
  const { locale, setLocale, t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  // Both icons render identically during SSR; CSS uses the class applied before paint.
  return <div className="flex shrink-0 items-center gap-1">
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("preferences.language.toggle")} title={t("preferences.language.toggle")}><Languages className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem lang="zh-CN" onSelect={() => setLocale("zh-CN")} aria-current={locale === "zh-CN" ? "true" : undefined}>简体中文{locale === "zh-CN" && " ✓"}</DropdownMenuItem><DropdownMenuItem lang="en-US" onSelect={() => setLocale("en-US")} aria-current={locale === "en-US" ? "true" : undefined}>English{locale === "en-US" && " ✓"}</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
    <Button variant="ghost" size="icon" disabled={!hydrated} aria-pressed={hydrated && resolvedTheme === "dark"} aria-label={t("preferences.theme.toggle")} title={t("preferences.theme.toggle")} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Moon className="size-4 dark:hidden" /><Sun className="hidden size-4 dark:block" /></Button>
  </div>;
}

export function LocalizedLoading() {
  const { t } = useI18n();
  return <p role="status">{t("common.loading")}</p>;
}
