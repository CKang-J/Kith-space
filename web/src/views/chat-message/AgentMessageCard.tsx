import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../../Avatar.tsx";
import { agentStatusLabel } from "../../agentStatus.ts";
import { SlidingSegmentedControl, type SlidingSegmentOption } from "../../components/SlidingTabs.tsx";
import type { Agent } from "../../store.tsx";
import { RESPONSE_MODE_COPY } from "../agent-response-mode/responseModeCopy.ts";
import type { AgentResponseMode, ChannelAgentResponseMode } from "../agent-response-mode/responseModeModel.ts";
import { shouldUpdateChannelResponseMode } from "./agentMessageCardModel.ts";
import { MessageIdentityCardFrame, type MessageCardAnchor } from "./MessageIdentityCardFrame.tsx";

export type AgentMessageCardAnchor = MessageCardAnchor;

interface AgentMessageCardProps {
  agent: Agent;
  avatarUrl: string | null;
  anchor: AgentMessageCardAnchor;
  trigger: HTMLElement;
  member?: ChannelAgentResponseMode;
  readOnly?: boolean;
  onClose(): void;
  onMessage(): Promise<void>;
  onChangeChannelMode?(value: AgentResponseMode | null): Promise<unknown>;
}

const CHANNEL_MODE_ORDER: AgentResponseMode[] = ["silent", "mention_only", "active"];
export function AgentMessageCard({
  agent,
  avatarUrl,
  anchor,
  trigger,
  member,
  readOnly = false,
  onClose,
  onMessage,
  onChangeChannelMode,
}: AgentMessageCardProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = (agent.activity && agent.activity !== "offline" ? agent.activity : agent.status) || "offline";
  const titleId = `agent-message-card-${agent.id}`;
  const modeDisabled = busy || readOnly || !onChangeChannelMode;
  const modeOptions: readonly SlidingSegmentOption<AgentResponseMode>[] = CHANNEL_MODE_ORDER.map((mode) => ({
    value: mode,
    label: t(RESPONSE_MODE_COPY[mode].shortLabelKey),
    disabled: modeDisabled,
  }));

  const run = async (
    action: () => Promise<unknown>,
    closeAfter = false,
    errorMessage = t("responseMode.saveFailed"),
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (closeAfter) onClose();
    } catch {
      setError(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const message = () => void run(async () => {
    try {
      await onMessage();
    } catch {
      throw new Error("message_agent_failed");
    }
  }, true, t("chat.messageAgentFailed"));

  const pickMode = (mode: AgentResponseMode) => {
    if (!member || readOnly || !onChangeChannelMode || !shouldUpdateChannelResponseMode(member, mode)) return;
    void run(() => onChangeChannelMode(mode));
  };

  const restoreDefault = () => {
    if (!member || readOnly || !onChangeChannelMode || member.responseModeOverride === null) return;
    void run(() => onChangeChannelMode(null));
  };

  return (
    <MessageIdentityCardFrame
      anchor={anchor}
      trigger={trigger}
      className="agent-message-card"
      labelledBy={titleId}
      placementKey={`${error}:${member?.responseModeOverride ?? ""}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="agent-message-card__identity">
        <Avatar seed={agent.name} url={avatarUrl} size={42} />
        <div className="agent-message-card__identity-copy">
          <strong id={titleId}>{agent.displayName || agent.name}</strong>
          <span>
            <i className={`dot ${live}`} aria-hidden="true" />
            {agentStatusLabel(t, live)}
            {agent.model ? <> · {agent.model}</> : null}
          </span>
        </div>
      </div>

      <div className="agent-message-card__actions">
        <button type="button" disabled={busy} onClick={message}>
          <MessageCircle size={18} aria-hidden="true" />
          <span>{t("chat.messageAgent")}</span>
        </button>
      </div>

      {member ? (
        <section className="agent-message-card__mode" aria-labelledby={`${titleId}-mode`}>
          <div className="agent-message-card__section-label" id={`${titleId}-mode`}>{t("responseMode.channelCardTitle")}</div>
          <SlidingSegmentedControl<AgentResponseMode>
            value={member.effectiveResponseMode}
            options={modeOptions}
            onChange={pickMode}
            ariaLabel={t("responseMode.channelSelection")}
            className="agent-message-card__segments"
            size="compact"
          />
          <div className="agent-message-card__scope">
            <span>
              {member.responseModeOverride === null
                ? t("responseMode.followingDefault", { mode: t(RESPONSE_MODE_COPY[member.defaultResponseMode].shortLabelKey) })
                : t("responseMode.channelOverrideSummary", { mode: t(RESPONSE_MODE_COPY[member.defaultResponseMode].shortLabelKey) })}
            </span>
            {member.responseModeOverride !== null && !readOnly && onChangeChannelMode ? (
              <button type="button" disabled={busy} onClick={restoreDefault}>{t("responseMode.restoreDefault")}</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? <div className="agent-message-card__error" role="alert">{error}</div> : null}
    </MessageIdentityCardFrame>
  );
}
