import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, UserMinus } from "lucide-react";
import { Avatar, resolveAvatar } from "../../Avatar.tsx";
import { SearchField } from "../../components/SearchField.tsx";
import { useConfirm } from "../../ConfirmModal.tsx";
import { useToast } from "../../toast.tsx";
import { ChannelAddMemberDialog } from "./ChannelAddMemberDialog.tsx";
import { filterAgents, responseError } from "./channelSettingsData.ts";
import type { ChannelSettingsAgent, ChannelSettingsApi } from "./types.ts";

interface ChannelMemberSettingsProps {
  channelId: string;
  agents: ChannelSettingsAgent[];
  human: { name: string } | null;
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
  human,
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
  const confirm = useConfirm();
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
  const availableAgents = useMemo(() => agents.filter((agent) => !memberIds.has(agent.id)), [agents, memberIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const humanVisible = !normalizedQuery
    || `${human?.name || t("channelSettings.members.human")} ${t("channelSettings.members.you")} ${t("channelSettings.members.administrator")}`
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
      if (method === "POST") setPickerOpen(false);
      toast.info(t(method === "POST" ? "channelSettings.members.addSuccess" : "channelSettings.members.removeSuccess", {
        name: agent.displayName || agent.name,
      }));
    } catch {
      setError(t("channelSettings.members.updateFailed"));
    } finally {
      setBusyAgentId(null);
    }
  };

  const removeMember = async (agent: ChannelSettingsAgent) => {
    const name = agent.displayName || agent.name;
    const accepted = await confirm({
      title: t("channelSettings.members.removeConfirmTitle", { name }),
      message: t("channelSettings.members.removeConfirmDescription"),
      confirmLabel: t("channelSettings.members.remove"),
      danger: true,
    });
    if (accepted) await mutateMember("DELETE", agent);
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
            onClick={() => {
              setError("");
              setPickerOpen(true);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {t("channelSettings.members.addMember")}
          </button>
        ) : null}
      </div>

      {pickerOpen ? (
        <ChannelAddMemberDialog
          agents={availableAgents}
          attachmentUrl={attachmentUrl}
          busy={busyAgentId !== null}
          error={error}
          onCancel={() => {
            setPickerOpen(false);
            setError("");
          }}
          onConfirm={(agent) => void mutateMember("POST", agent)}
        />
      ) : null}

      <section className="channel-settings-members__list" aria-label={t("channelSettings.members.currentMembers")}>
        {humanVisible ? (
          <div className="channel-settings-member">
            <Avatar seed={human?.name || t("channelSettings.members.human")} size={30} />
            <span className="channel-settings-member__identity">
              <span className="channel-settings-member__name-row">
                <strong>{human?.name || t("channelSettings.members.human")}</strong>
                <span className="channel-settings-member__you">{t("channelSettings.members.you")}</span>
              </span>
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
            onAction={() => void removeMember(agent)}
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
