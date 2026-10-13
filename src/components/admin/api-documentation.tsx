"use client";
import dynamic from "next/dynamic";
import { useI18n, LocalizedLoading } from "@/components/preferences";
import { buttonVariants } from "@/components/ui/button";
import { Download } from "lucide-react";

const Reference = dynamic(() => import("./scalar-reference").then(module => module.ScalarReference), { ssr: false, loading: LocalizedLoading });

export function ApiDocumentation() {
  const { locale, t } = useI18n();
  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t("API 文档")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("完整覆盖 Launcher、客户端上传与发布、后台和认证接口。文档可见不等于拥有业务操作权限。")}</p></div>
      <a href={`/api/admin/openapi?locale=${locale}`} download={`union-link.${locale}.openapi.json`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download />{t("下载 OpenAPI JSON")}</a>
    </div>
    <Reference />
  </section>;
}
