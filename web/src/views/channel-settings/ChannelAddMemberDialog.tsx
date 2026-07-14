import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Avatar, resolveAvatar } from "../../Avatar.tsx";
import { SearchField } from "../../components/SearchField.tsx";
import { useEscClose } from "../../ConfirmModal.tsx";
import { filterAgents } from "./channelSettingsData.ts";
import type { ChannelSettingsAgent } from "./types.ts";

interface ChannelAddMemberDialogProps {
  agents: ChannelSettingsAgent[];
  attachmentUrl(attachmentId: string): string;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(agent: ChannelSettingsAgent): void;
}

export function ChannelAddMemberDialog({
  agents,
  attachmentUrl,
  busy,
  error,
  onCancel,
  onConfirm,
}: ChannelAddMemberDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visibleAgents = useMemo(() => filterAgents(agents, query), [agents, query]);
  const selectedAgent = agents.find((agent) => agent.id === selectedId) ?? null;
  const close = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);
  useEscClose(close);

  return createPortal(
    <div className="modal-bg channel-settings-member-dialog-backdrop" onClick={close}>
      <div
        className="channel-settings-member-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-settings-member-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="channel-settings-member-dialog-title">{t("channelSettings.members.addMember")}</h3>
        <p>{t("channelSettings.members.addMemberDescription")}</p>
        <SearchField
          autoFocus
          value={query}
          onValueChange={setQuery}
          clearLabel={t("channelSettings.members.clearAgentSearch")}
          placeholder={t("channelSettings.members.agentSearchPlaceholder")}
          aria-label={t("channelSettings.members.agentSearchLabel")}
        />
        <div className="channel-settings-member-dialog__list" role="radiogroup" aria-label={t("channelSettings.members.availableAgents")}>
          {visibleAgents.length ? visibleAgents.map((agent) => (
            <label key={agent.id} className="channel-settings-member-dialog__option">
              <input
                type="radio"
                name="channel-member-agent"
                value={agent.id}
                checked={selectedId === agent.id}
                onChange={() => setSelectedId(agent.id)}
                disabled={busy}
              />
              <Avatar seed={agent.name} url={resolveAvatar(agent.avatarUrl, attachmentUrl)} size={32} />
              <span>
                <strong>{agent.displayName || agent.name}</strong>
                <small>@{agent.name}</small>
              </span>
            </label>
          )) : <div className="channel-settings__empty">{t("channelSettings.members.noAvailableAgents")}</div>}
        </div>
        {error ? <div className="channel-settings__error" role="alert">{error}</div> : null}
        <div className="channel-settings-member-dialog__actions">
          <button type="button" className="channel-settings__button" onClick={close} disabled={busy}>
            {t("channelSettings.cancel")}
          </button>
          <button
            type="button"
            className="channel-settings__button channel-settings__button--primary"
            onClick={() => selectedAgent && onConfirm(selectedAgent)}
            disabled={!selectedAgent || busy}
          >
            {busy ? t("channelSettings.members.adding") : t("channelSettings.members.chooseMember")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
