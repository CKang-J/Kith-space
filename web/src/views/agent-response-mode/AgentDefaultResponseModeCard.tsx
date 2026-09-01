import { useEffect, useState } from "react";
import { MessageSquareReply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SlidingSegmentedControl, type SlidingSegmentOption } from "../../components/SlidingTabs.tsx";
import { useStore } from "../../store.tsx";
import { AGENT_RESPONSE_MODES, isAgentResponseMode, type AgentResponseMode } from "./responseModeModel.ts";
import { RESPONSE_MODE_COPY } from "./responseModeCopy.ts";

interface AgentDefaultResponseModeCardProps {
  agentId: string;
  value: AgentResponseMode;
  onSaved?(value: AgentResponseMode): void;
}

export function AgentDefaultResponseModeCard({ agentId, value, onSaved }: AgentDefaultResponseModeCardProps) {
  const { t } = useTranslation();
  const { api } = useStore();
  const [selected, setSelected] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const modeOptions: readonly SlidingSegmentOption<AgentResponseMode>[] = AGENT_RESPONSE_MODES.map((mode) => ({
    value: mode,
    label: t(RESPONSE_MODE_COPY[mode].labelKey),
    disabled: saving,
  }));

  useEffect(() => {
    if (!saving) setSelected(value);
  }, [saving, value]);

  const save = async (next: AgentResponseMode) => {
    if (saving || next === selected) return;
    const previous = selected;
    setSelected(next);
    setSaving(true);
    setError("");
    try {
      const response = await api("PATCH", `/api/agents/${encodeURIComponent(agentId)}`, { defaultResponseMode: next });
      if (response?.error) throw new Error(String(response.error));
      const saved = isAgentResponseMode(response?.defaultResponseMode) ? response.defaultResponseMode : next;
      setSelected(saved);
      onSaved?.(saved);
    } catch {
      let restored = previous;
      try {
        const agent = await api("GET", `/api/agents/${encodeURIComponent(agentId)}`);
        if (isAgentResponseMode(agent?.defaultResponseMode)) restored = agent.defaultResponseMode;
      } catch { /* keep the last confirmed value when the refetch is also unavailable */ }
      setSelected(restored);
      onSaved?.(restored);
      setError(t("responseMode.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card space-y-3" aria-labelledby={`agent-response-mode-${agentId}`}>
      <div>
        <h3 id={`agent-response-mode-${agentId}`} className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquareReply className="size-4 text-primary" /> {t("responseMode.title")}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">{t("responseMode.defaultDescription")}</p>
      </div>
      <SlidingSegmentedControl<AgentResponseMode>
        value={selected}
        options={modeOptions}
        onChange={(mode) => void save(mode)}
        ariaLabel={t("responseMode.title")}
        className="agent-response-mode-card__segments"
      />
      <div className="space-y-1 text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/40">
        <p className="leading-relaxed font-medium text-foreground/90">{t(RESPONSE_MODE_COPY[selected].descriptionKey)}</p>
        <p className="leading-relaxed text-muted-foreground/80">{t("responseMode.directMessageException")}</p>
      </div>
      {error ? <div className="text-xs text-destructive font-medium" role="alert">{error}</div> : null}
    </section>
  );
}
