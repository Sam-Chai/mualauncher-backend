import { z } from "zod";

const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), "展示配置无效");
export const displayScheduleSchema = z.object({
  displayMode: z.enum(["PERMANENT", "RANGE"]),
  displayStartsAt: timestamp.nullable(),
  displayEndsAt: timestamp.nullable(),
}).superRefine((value, ctx) => {
  if (value.displayMode === "PERMANENT") {
    if (value.displayStartsAt !== null || value.displayEndsAt !== null)
      ctx.addIssue({ code: "custom", message: "永久展示不能设置展示区间" });
  } else if (!value.displayStartsAt || !value.displayEndsAt || Date.parse(value.displayStartsAt) >= Date.parse(value.displayEndsAt)) {
    ctx.addIssue({ code: "custom", message: "请选择有效展示区间，结束时间须晚于开始时间" });
  }
});

export type DisplaySchedule = {
  displayMode: string;
  displayStartsAt: string | Date | null;
  displayEndsAt: string | Date | null;
};

export function displayWindowOpen(value: DisplaySchedule, now = new Date()) {
  return value.displayMode === "PERMANENT" || value.displayMode === "RANGE" &&
    value.displayStartsAt !== null && value.displayEndsAt !== null &&
    new Date(value.displayStartsAt).getTime() <= now.getTime() && now.getTime() < new Date(value.displayEndsAt).getTime();
}

// Admin dates use the same fixed Asia/Shanghai time zone as the rest of the UI.
export function displayTimeInput(value: string | Date | null) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 19) : "";
}
export function displayTimeIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value}+08:00`);
  return Number.isFinite(date.getTime()) && displayTimeInput(date).slice(0, value.length) === value ? date.toISOString() : null;
}
