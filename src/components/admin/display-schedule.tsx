"use client";
import { useI18n } from "@/components/preferences";
import type { DisplaySchedule } from "@/lib/server-display";

export function DisplayScheduleNote({ schedule }: { schedule: DisplaySchedule | null }) {
  const { t, formatDate } = useI18n();
  if (schedule?.displayMode !== "RANGE") return null;
  return <p className="text-xs text-muted-foreground">{t("区间展示：{0}-{1}", {
    "0": formatDate(schedule.displayStartsAt), "1": formatDate(schedule.displayEndsAt),
  })}</p>;
}
