import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <section className="card agent-response-mode-card" aria-labelledby={`agent-response-mode-${agentId}`}>
      <h3 id={`agent-response-mode-${agentId}`}>{t("responseMode.title")}</h3>
      <p className="meta agent-response-mode-card__description">{t("responseMode.defaultDescription")}</p>
      <div className="agent-response-mode-card__segments" role="radiogroup" aria-label={t("responseMode.title")}>
        {AGENT_RESPONSE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected === mode}
            className={selected === mode ? "is-selected" : ""}
            disabled={saving}
            onClick={() => void save(mode)}
          >
            {t(RESPONSE_MODE_COPY[mode].labelKey)}
          </button>
        ))}
      </div>
      <p className="agent-response-mode-card__hint">{t(RESPONSE_MODE_COPY[selected].descriptionKey)}</p>
      <p className="agent-response-mode-card__hint">{t("responseMode.directMessageException")}</p>
      {error ? <div className="agent-response-mode-card__error" role="alert">{error}</div> : null}
    </section>
  );
}
