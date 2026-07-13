import type { TFunction } from "i18next";

export function agentStatusLabel(t: TFunction, status?: string | null): string {
  const value = status || "offline";
  return t(`members.statuses.${value}`, { defaultValue: value });
}
