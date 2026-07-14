import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, UserMinus, X } from "lucide-react";
import { Avatar, resolveAvatar } from "../../Avatar.tsx";
import { SearchField } from "../../components/SearchField.tsx";
import { useToast } from "../../toast.tsx";
import { filterAgents, responseError } from "./channelSettingsData.ts";
import type { ChannelSettingsAgent, ChannelSettingsApi } from "./types.ts";

interface ChannelMemberSettingsProps {
  channelId: string;
  agents: ChannelSettingsAgent[];
  members: ChannelSettingsAgent[];
  attachmentUrl(attachmentId: string): string;
  loading: boolean;
  loadError: string;
  readOnly?: boolean;
  api: ChannelSettingsApi;
  reload(): Promise<void>;
  reloadMembers(): Promise<void>;
}

export function ChannelMemberSettings({
  channelId,
  agents,
  members,
  attachmentUrl,
  loading,
  loadError,
  readOnly = false,
  api,
  reload,
  reloadMembers,
}: ChannelMemberSettingsProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuery("");
    setPickerOpen(false);
    setBusyAgentId(null);
    setError("");
  }, [channelId]);

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const visibleMembers = useMemo(() => filterAgents(members, query), [members, query]);
  const availableAgents = useMemo(
    () => filterAgents(agents.filter((agent) => !memberIds.has(agent.id)), query),
    [agents, memberIds, query],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const humanVisible = !normalizedQuery
    || `${t("channelSettings.members.you")} ${t("channelSettings.members.administrator")}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);

  const mutateMember = async (method: "POST" | "DELETE", agent: ChannelSettingsAgent) => {
    if (busyAgentId || readOnly) return;
    setBusyAgentId(agent.id);
    setError("");
    try {
      const result = await api(method, `/api/channels/${encodeURIComponent(channelId)}/members`, { agentId: agent.id });
      const detail = responseError(result);
      if (detail) {
        setError(`${t("channelSettings.members.updateFailed")}: ${detail}`);
        return;
      }
      await reloadMembers();
      await reload();
      toast.info(t(method === "POST" ? "channelSettings.members.addSuccess" : "channelSettings.members.removeSuccess", {
        name: agent.displayName || agent.name,
      }));
    } catch {
      setError(t("channelSettings.members.updateFailed"));
    } finally {
      setBusyAgentId(null);
    }
  };

  return (
    <div className="channel-settings__page channel-settings-members">
      {readOnly ? <p className="channel-settings__notice">{t("channelSettings.archivedSettingsReadOnly")}</p> : null}
      <SearchField
        value={query}
        onValueChange={setQuery}
        clearLabel={t("channelSettings.members.clearSearch")}
        placeholder={t("channelSettings.members.searchPlaceholder")}
        aria-label={t("channelSettings.members.searchLabel")}
      />

      <div className="channel-settings-members__toolbar">
        <span>{t("channelSettings.members.count", { count: members.length + 1 })}</span>
        {!readOnly ? (
          <button
            type="button"
            className="channel-settings__button channel-settings__button--compact"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
          >
            {pickerOpen ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {pickerOpen ? t("channelSettings.members.closePicker") : t("channelSettings.members.addMember")}
          </button>
        ) : null}
      </div>

      {pickerOpen ? (
        <section className="channel-settings-members__picker" aria-label={t("channelSettings.members.availableAgents")}>
          <h3>{t("channelSettings.members.availableAgents")}</h3>
          {availableAgents.length ? availableAgents.map((agent) => (
            <MemberRow
              key={agent.id}
              agent={agent}
              avatarUrl={resolveAvatar(agent.avatarUrl, attachmentUrl)}
              actionLabel={t("channelSettings.members.addAgent", { name: agent.displayName || agent.name })}
              actionText={busyAgentId === agent.id ? t("channelSettings.members.adding") : t("channelSettings.members.add")}
              actionDisabled={busyAgentId !== null}
              onAction={() => void mutateMember("POST", agent)}
            />
          )) : <div className="channel-settings__empty">{t("channelSettings.members.noAvailableAgents")}</div>}
        </section>
      ) : null}

      <section className="channel-settings-members__list" aria-label={t("channelSettings.members.currentMembers")}>
        {humanVisible ? (
          <div className="channel-settings-member">
            <Avatar seed={t("channelSettings.members.you")} size={30} />
            <span className="channel-settings-member__identity">
              <strong>{t("channelSettings.members.you")}</strong>
              <small>{t("channelSettings.members.administrator")}</small>
            </span>
            <span className="channel-settings-member__fixed">{t("channelSettings.members.fixed")}</span>
          </div>
        ) : null}

        {loading ? <div className="channel-settings__empty">{t("channelSettings.loading")}</div> : null}
        {!loading && visibleMembers.map((agent) => (
          <MemberRow
            key={agent.id}
            agent={agent}
            avatarUrl={resolveAvatar(agent.avatarUrl, attachmentUrl)}
            actionLabel={t("channelSettings.members.removeAgent", { name: agent.displayName || agent.name })}
            actionText={busyAgentId === agent.id ? t("channelSettings.members.removing") : <UserMinus size={15} aria-hidden="true" />}
            actionDisabled={readOnly || busyAgentId !== null}
            actionDanger
            hideAction={readOnly}
            onAction={() => void mutateMember("DELETE", agent)}
          />
        ))}
        {!loading && query && !humanVisible && visibleMembers.length === 0 ? (
          <div className="channel-settings__empty">{t("channelSettings.members.noMatches")}</div>
        ) : null}
      </section>

      {(error || loadError) ? <div className="channel-settings__error" role="alert">{error || loadError}</div> : null}
    </div>
  );
}

interface MemberRowProps {
  agent: ChannelSettingsAgent;
  avatarUrl: string | null;
  actionLabel: string;
  actionText: ReactNode;
  actionDisabled: boolean;
  actionDanger?: boolean;
  hideAction?: boolean;
  onAction(): void;
}

function MemberRow({
  agent,
  avatarUrl,
  actionLabel,
  actionText,
  actionDisabled,
  actionDanger = false,
  hideAction = false,
  onAction,
}: MemberRowProps) {
  return (
    <div className="channel-settings-member">
      <Avatar seed={agent.name} url={avatarUrl} size={30} />
      <span className="channel-settings-member__identity">
        <strong>{agent.displayName || agent.name}</strong>
        <small>@{agent.name}</small>
      </span>
      {!hideAction ? (
        <button
          type="button"
          className={`channel-settings-member__action${actionDanger ? " channel-settings-member__action--danger" : ""}`}
          aria-label={actionLabel}
          title={actionLabel}
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionText}
        </button>
      ) : null}
    </div>
  );
}
