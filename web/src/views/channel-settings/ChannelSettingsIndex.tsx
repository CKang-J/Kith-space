import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bell,
  ChevronRight,
  Globe,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useConfirm } from "../../ConfirmModal.tsx";
import { useToast } from "../../toast.tsx";
import { isRequiredChannel, responseError } from "./channelSettingsData.ts";
import { ChannelDeleteDialog } from "./ChannelDeleteDialog.tsx";
import type {
  ChannelNotificationLevel,
  ChannelSettingsApi,
  ChannelSettingsChannel,
  ChannelSettingsPage,
} from "./types.ts";

interface ChannelSettingsIndexProps {
  channel: ChannelSettingsChannel;
  memberCount: number;
  membersLoading: boolean;
  notificationLevel: ChannelNotificationLevel;
  notificationLoading: boolean;
  api: ChannelSettingsApi;
  reload(): Promise<void>;
  onNavigate(page: Exclude<ChannelSettingsPage, "index">): void;
  onArchived?(channelId: string): void;
  onRestored?(channelId: string): void;
  onDeleted?(channelId: string): void;
}

type LifecycleAction = "archive" | "restore" | "delete";

export function ChannelSettingsIndex({
  channel,
  memberCount,
  membersLoading,
  notificationLevel,
  notificationLoading,
  api,
  reload,
  onNavigate,
  onArchived,
  onRestored,
  onDeleted,
}: ChannelSettingsIndexProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const required = isRequiredChannel(channel);
  const archived = !!channel.archivedAt;

  const notificationSummary = notificationLoading
    ? t("channelSettings.loading")
    : t(`channelSettings.notifications.options.${notificationLevel}.title`);

  const runLifecycle = async (
    action: LifecycleAction,
    method: string,
    path: string,
    successKey: string,
    onSuccess?: (channelId: string) => void,
  ) => {
    setBusy(action);
    setError("");
    try {
      const result = await api(method, path);
      const detail = responseError(result);
      if (detail) {
        setError(`${t("channelSettings.operationFailed")}: ${detail}`);
        return false;
      }
      await reload();
      toast.info(t(successKey));
      onSuccess?.(channel.id);
      return true;
    } catch {
      setError(t("channelSettings.operationFailed"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const archiveChannel = async () => {
    const accepted = await confirm({
      title: t("channelSettings.archiveConfirmTitle", { name: channel.name }),
      message: t("channelSettings.archiveConfirmDescription"),
      confirmLabel: t("channelSettings.archiveChannel"),
    });
    if (!accepted) return;
    await runLifecycle(
      "archive",
      "POST",
      `/api/channels/${encodeURIComponent(channel.id)}/archive`,
      "channelSettings.archiveSuccess",
      onArchived,
    );
  };

  const restoreChannel = async () => {
    await runLifecycle(
      "restore",
      "POST",
      `/api/channels/${encodeURIComponent(channel.id)}/unarchive`,
      "channelSettings.restoreSuccess",
      onRestored,
    );
  };

  const deleteChannel = async () => {
    const deleted = await runLifecycle(
      "delete",
      "DELETE",
      `/api/channels/${encodeURIComponent(channel.id)}`,
      "channelSettings.deleteSuccess",
      onDeleted,
    );
    if (deleted) setShowDelete(false);
  };

  const rows: Array<{
    page: Exclude<ChannelSettingsPage, "index">;
    icon: typeof Globe;
    title: string;
    summary: string;
  }> = [
    {
      page: "general",
      icon: Globe,
      title: t("channelSettings.general.title"),
      summary: `# ${channel.name}`,
    },
    {
      page: "members",
      icon: UsersRound,
      title: t("channelSettings.members.title"),
      summary: membersLoading ? t("channelSettings.loading") : t("channelSettings.members.summary", { count: memberCount }),
    },
    {
      page: "notifications",
      icon: Bell,
      title: t("channelSettings.notifications.title"),
      summary: notificationSummary,
    },
  ];

  return (
    <div className="channel-settings__page channel-settings__index">
      <div className="channel-settings__rows">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              key={row.page}
              type="button"
              className="channel-settings__row"
              onClick={() => onNavigate(row.page)}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="channel-settings__row-copy">
                <strong>{row.title}</strong>
                <small>{row.summary}</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {archived ? <p className="channel-settings__notice">{t("channelSettings.archivedSettingsReadOnly")}</p> : null}
      {required ? <p className="channel-settings__notice">{t("channelSettings.requiredChannelDescription")}</p> : null}

      {!required ? (
        <div className="channel-settings__lifecycle">
          {archived ? (
            <button
              type="button"
              className="channel-settings__lifecycle-action"
              onClick={restoreChannel}
              disabled={busy !== null}
            >
              <Archive size={16} aria-hidden="true" />
              <span>
                <strong>{busy === "restore" ? t("channelSettings.restoring") : t("channelSettings.restoreChannel")}</strong>
                <small>{t("channelSettings.restoreDescription")}</small>
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="channel-settings__lifecycle-action"
              onClick={archiveChannel}
              disabled={busy !== null}
            >
              <Archive size={16} aria-hidden="true" />
              <span>
                <strong>{busy === "archive" ? t("channelSettings.archiving") : t("channelSettings.archiveChannel")}</strong>
                <small>{t("channelSettings.archiveDescription")}</small>
              </span>
            </button>
          )}
          <button
            type="button"
            className="channel-settings__lifecycle-action channel-settings__lifecycle-action--danger"
            onClick={() => {
              setError("");
              setShowDelete(true);
            }}
            disabled={busy !== null}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>
              <strong>{t("channelSettings.deleteChannel")}</strong>
              <small>{t("channelSettings.deleteDescription")}</small>
            </span>
          </button>
        </div>
      ) : null}

      {error && !showDelete ? <div className="channel-settings__error" role="alert">{error}</div> : null}
      {showDelete ? (
        <ChannelDeleteDialog
          channelName={channel.name}
          busy={busy === "delete"}
          error={error}
          onCancel={() => {
            setShowDelete(false);
            setError("");
          }}
          onConfirm={deleteChannel}
        />
      ) : null}
    </div>
  );
}
