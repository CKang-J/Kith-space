import type {
  ChannelNotificationLevel,
  ChannelSettingsAgent,
  ChannelSettingsChannel,
} from "./types.ts";

export interface ChannelGeneralForm {
  name: string;
  description: string;
  visibility: "public" | "private";
}

export function isRequiredChannel(channel: ChannelSettingsChannel): boolean {
  return channel.isRequired === true || channel.name.trim().replace(/^#/, "").toLowerCase() === "all";
}

export function channelVisibility(channel: ChannelSettingsChannel): "public" | "private" {
  return channel.type === "private" ? "private" : "public";
}

export function generalFormForChannel(channel: ChannelSettingsChannel): ChannelGeneralForm {
  return {
    name: channel.name,
    description: channel.description ?? "",
    visibility: channelVisibility(channel),
  };
}

export function isGeneralFormDirty(form: ChannelGeneralForm, saved: ChannelGeneralForm): boolean {
  return form.name !== saved.name
    || form.description !== saved.description
    || form.visibility !== saved.visibility;
}

export function normalizeNotificationLevel(value: unknown): ChannelNotificationLevel {
  return value === "mentions" || value === "none" ? value : "all";
}

export function filterAgents(agents: ChannelSettingsAgent[], query: string): ChannelSettingsAgent[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return agents;
  return agents.filter((agent) => `${agent.displayName ?? ""} ${agent.name}`.toLocaleLowerCase().includes(needle));
}

export function matchesDeleteConfirmation(input: string, channelName: string): boolean {
  return input.trim() === channelName;
}

export function responseError(response: unknown): string | null {
  if (!response || typeof response !== "object" || !("error" in response)) return null;
  const error = (response as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : "request_failed";
}
