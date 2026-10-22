"use client";
import dynamic from "next/dynamic";
import { useI18n, LocalizedLoading } from "@/components/preferences";
import { buttonVariants } from "@/components/ui/button";
import { Download } from "lucide-react";

const Reference = dynamic(() => import("./scalar-reference").then(module => module.ScalarReference), { ssr: false, loading: LocalizedLoading });

export function ApiDocumentation() {
  const { locale, t } = useI18n();
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t("apiDocumentation.apiReference")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("apiDocumentation.coversLauncherClientUploadsAndPublishingAdministrationAndAuthentication")}</p></div>
      <a href={`/api/admin/openapi?locale=${locale}`} download={`union-link.${locale}.openapi.json`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download />{t("apiDocumentation.downloadOpenapiJson")}</a>
    </div>
    <Reference />
  </section>;
}
