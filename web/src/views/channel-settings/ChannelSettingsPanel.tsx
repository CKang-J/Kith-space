import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X } from "lucide-react";
import { useConfirm } from "../../ConfirmModal.tsx";
import { normalizeNotificationLevel, responseError } from "./channelSettingsData.ts";
import { ChannelGeneralSettings } from "./ChannelGeneralSettings.tsx";
import { ChannelMemberSettings } from "./ChannelMemberSettings.tsx";
import { ChannelNotificationSettings } from "./ChannelNotificationSettings.tsx";
import { ChannelSettingsIndex } from "./ChannelSettingsIndex.tsx";
import type {
  ChannelNotificationLevel,
  ChannelSettingsAgent,
  ChannelSettingsPage,
  ChannelSettingsPanelProps,
} from "./types.ts";
import "./channelSettings.css";

export function ChannelSettingsPanel({
  channel,
  agents,
  attachmentUrl,
  api,
  reload,
  onBackToContent,
  onClose,
  onArchived,
  onRestored,
  onDeleted,
  onChannelUpdated,
  onDirtyChange,
}: ChannelSettingsPanelProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const apiRef = useRef(api);
  const translationRef = useRef(t);
  apiRef.current = api;
  translationRef.current = t;
  const memberRequestRef = useRef(0);
  const notificationRequestRef = useRef(0);
  const [page, setPage] = useState<ChannelSettingsPage>("index");
  const [dirty, setDirty] = useState(false);
  const [members, setMembers] = useState<ChannelSettingsAgent[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [notificationLevel, setNotificationLevel] = useState<ChannelNotificationLevel>("all");
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState("");
  const readOnly = !!channel.archivedAt;

  const loadMembers = useCallback(async () => {
    const request = ++memberRequestRef.current;
    setMembersLoading(true);
    setMembersError("");
    try {
      const result = await apiRef.current("GET", `/api/channels/${encodeURIComponent(channel.id)}/members`);
      if (request !== memberRequestRef.current) return;
      const detail = responseError(result);
      if (detail) {
        setMembersError(`${translationRef.current("channelSettings.members.loadFailed")}: ${detail}`);
        return;
      }
      setMembers(Array.isArray(result?.agents) ? result.agents : []);
    } catch {
      if (request === memberRequestRef.current) setMembersError(translationRef.current("channelSettings.members.loadFailed"));
    } finally {
      if (request === memberRequestRef.current) setMembersLoading(false);
    }
  }, [channel.id]);

  const loadNotification = useCallback(async () => {
    const request = ++notificationRequestRef.current;
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const result = await apiRef.current("GET", `/api/channels/${encodeURIComponent(channel.id)}/notification`);
      if (request !== notificationRequestRef.current) return;
      const detail = responseError(result);
      if (detail) {
        setNotificationError(`${translationRef.current("channelSettings.notifications.loadFailed")}: ${detail}`);
        return;
      }
      setNotificationLevel(normalizeNotificationLevel(result?.notificationLevel));
    } catch {
      if (request === notificationRequestRef.current) setNotificationError(translationRef.current("channelSettings.notifications.loadFailed"));
    } finally {
      if (request === notificationRequestRef.current) setNotificationLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    setPage("index");
    setDirty(false);
    setMembers([]);
    setNotificationLevel("all");
    void loadMembers();
    void loadNotification();
  }, [channel.id, loadMembers, loadNotification]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const confirmDiscard = async () => {
    if (!dirty) return true;
    return confirm({
      title: t("channelSettings.discardTitle"),
      message: t("channelSettings.discardDescription"),
      confirmLabel: t("channelSettings.discardChanges"),
    });
  };

  const back = async () => {
    if (!(await confirmDiscard())) return;
    setDirty(false);
    if (page === "index") onBackToContent();
    else setPage("index");
  };

  const close = async () => {
    if (!(await confirmDiscard())) return;
    setDirty(false);
    onClose();
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".confirm-modal, .channel-settings-delete-dialog")) return;
      void close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dirty, onClose]);

  const title = page === "index"
    ? t("channelSettings.title")
    : t(`channelSettings.${page}.title`);

  return (
    <section className="channel-settings" aria-label={t("channelSettings.title")}>
      <header className="channel-settings__header">
        <button
          type="button"
          className="channel-settings__icon-button"
          aria-label={page === "index" ? t("channelSettings.backToContent") : t("channelSettings.back")}
          title={page === "index" ? t("channelSettings.backToContent") : t("channelSettings.back")}
          onClick={() => void back()}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <h2>{title}</h2>
        <button
          type="button"
          className="channel-settings__icon-button"
          aria-label={t("channelSettings.close")}
          title={t("channelSettings.close")}
          onClick={() => void close()}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="channel-settings__content">
        {page === "index" ? (
          <ChannelSettingsIndex
            channel={channel}
            memberCount={members.length + 1}
            membersLoading={membersLoading}
            notificationLevel={notificationLevel}
            notificationLoading={notificationLoading}
            api={api}
            reload={reload}
            onNavigate={setPage}
            onArchived={onArchived}
            onRestored={onRestored}
            onDeleted={onDeleted}
          />
        ) : null}
        {page === "general" ? (
          <ChannelGeneralSettings
            channel={channel}
            api={api}
            reload={reload}
            readOnly={readOnly}
            onDirtyChange={setDirty}
            onSaved={onChannelUpdated}
          />
        ) : null}
        {page === "members" ? (
          <ChannelMemberSettings
            channelId={channel.id}
            agents={agents}
            members={members}
            attachmentUrl={attachmentUrl}
            loading={membersLoading}
            loadError={membersError}
            readOnly={readOnly}
            api={api}
            reload={reload}
            reloadMembers={loadMembers}
          />
        ) : null}
        {page === "notifications" ? (
          <ChannelNotificationSettings
            channelId={channel.id}
            level={notificationLevel}
            loading={notificationLoading}
            loadError={notificationError}
            readOnly={readOnly}
            api={api}
            onLevelChange={setNotificationLevel}
          />
        ) : null}
      </div>
    </section>
  );
}
