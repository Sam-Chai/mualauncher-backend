"use client";
import { useI18n } from "@/components/preferences";
import type { DisplaySchedule } from "@/lib/server-display";

export function DisplayScheduleNote({ schedule }: { schedule: DisplaySchedule | null }) {
  const { t, formatDate } = useI18n();
  if (schedule?.displayMode !== "RANGE") return null;
  return <p className="text-xs text-muted-foreground">{t("displaySchedule.window", {
    "startsAt": formatDate(schedule.displayStartsAt), "endsAt": formatDate(schedule.displayEndsAt),
  })}</p>;
}
