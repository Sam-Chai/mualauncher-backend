"use client";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export type OrganizationSkinSite = { code: string; url: string };
function safeSites(sites: OrganizationSkinSite[]) {
  return sites.filter(site => { try { const u = new URL(site.url); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } });
}
export function OrganizationSkinSiteField({ id, sites = [] }: { id: string; sites?: OrganizationSkinSite[] }) {
  const { t } = useI18n(), valid = safeSites(sites);
  return <section className="space-y-2"><Label htmlFor={`skin-site-${id}`}>{t("organizationAccess.skinSiteUrl")}</Label>
    {valid.length ? valid.map((site,index) => <div key={`${site.code}:${site.url}`} className="space-y-1">{valid.length>1 && <p className="text-xs text-muted-foreground">{site.code} · {new URL(site.url).hostname}</p>}<Input id={index===0?`skin-site-${id}`:undefined} aria-label={index===0?undefined:`${site.code} · ${new URL(site.url).hostname}`} readOnly value={site.url} /></div>)
      : <Input id={`skin-site-${id}`} readOnly value="" placeholder={t("organizationSkinSites.noSkinSiteAddress")} />}
    <p className="text-xs text-muted-foreground">{t("organizationSkinSites.addressesAreFilledAutomaticallyFromUnionSkinSiteMappings")}</p>
  </section>;
}
export function VisitSkinSite({ sites = [] }: { sites?: OrganizationSkinSite[] }) {
  const { t } = useI18n(), valid = safeSites(sites);
  if (!valid.length) return <Button type="button" variant="outline" size="sm" disabled title={t("organizationSkinSites.noSkinSiteAddress")}><ExternalLink className="size-3.5" />{t("organizationSkinSites.visitSkinSite")}</Button>;
  if (valid.length===1) return <Button variant="outline" size="sm" asChild><a href={valid[0].url} target="_blank" rel="noopener noreferrer" title={valid[0].url}><ExternalLink className="size-3.5" />{t("organizationSkinSites.visitSkinSite")}</a></Button>;
  return <div className="flex flex-wrap gap-2">{valid.map(site => <Button key={`${site.code}:${site.url}`} variant="outline" size="sm" asChild><a href={site.url} target="_blank" rel="noopener noreferrer" title={site.url}><ExternalLink className="size-3.5" />{t("organizationSkinSites.visitSkinSite")} · {new URL(site.url).hostname}</a></Button>)}</div>;
}
