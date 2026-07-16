export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function relativeTimeLabel(iso: string | null | undefined, t: Translate): string {
  if (!iso) return "";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (!Number.isFinite(elapsedMinutes)) return "";
  if (elapsedMinutes < 1) return t("misc.relTimeJustNow");
  if (elapsedMinutes < 60) return t("misc.relTimeMinutes", { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t("misc.relTimeHours", { count: elapsedHours });
  return t("misc.relTimeDays", { count: Math.floor(elapsedHours / 24) });
}
