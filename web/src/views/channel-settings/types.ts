export type ChannelNotificationLevel = "all" | "mentions" | "none";

export type ChannelSettingsPage = "index" | "general" | "members" | "notifications";

export interface ChannelSettingsChannel {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  archivedAt?: string | null;
  isRequired?: boolean;
}

export interface ChannelSettingsAgent {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  status?: string | null;
  activity?: string | null;
  avatarUrl?: string | null;
}

export type ChannelSettingsApi = (method: string, path: string, body?: unknown) => Promise<any>;

export interface ChannelSettingsPanelProps {
  channel: ChannelSettingsChannel;
  agents: ChannelSettingsAgent[];
  attachmentUrl(attachmentId: string): string;
  api: ChannelSettingsApi;
  reload(): Promise<void>;
  onBackToContent(): void;
  onClose(): void;
  onArchived?(channelId: string): void;
  onRestored?(channelId: string): void;
  onDeleted?(channelId: string): void;
  onChannelUpdated?(channelId: string): void;
  onDirtyChange?(dirty: boolean): void;
}
