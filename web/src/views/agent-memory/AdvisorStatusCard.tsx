import { useTranslation } from "react-i18next";
import { fmtDateTime } from "../../format.ts";
import type { AdvisorJob, AdvisorState, SuppressionRecord } from "./types.ts";

function dateLabel(value: string | number | null | undefined): string {
  return value == null ? "—" : fmtDateTime(value as any);
}

export function AdvisorStatusCard({
  state,
  jobs,
  suppressions,
  busy,
  onPatch,
  onRevokeSuppression,
}: {
  state: AdvisorState | null;
  jobs: AdvisorJob[];
  suppressions: SuppressionRecord[];
  busy: boolean;
  onPatch: (patch: { enabled?: boolean; paused?: boolean }) => Promise<void>;
  onRevokeSuppression: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (!state) return <section className="memory-advisor-card"><span className="meta">{t("members.loading")}</span></section>;
  const enabled = Boolean(state.settings.enabled);
  const paused = Boolean(state.settings.pausedAt);
  const supported = state.support.toolIsolation === "enforced";
  const latest = state.latestJob;
  const pending = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failures = jobs.filter((job) => job.status === "failed" || job.status === "blocked");
  const activeSuppressions = suppressions.filter(({ item }) => item.status === "active");

  return (
    <section className="memory-advisor-card" aria-label={t("members.memoryPanel.advisor.title")}>
      <div className="memory-advisor-head">
        <div>
          <div className="who">{t("members.memoryPanel.advisor.title")}</div>
          <div className="meta">
            {state.runtime} · {supported ? t("members.memoryPanel.advisor.available") : t("members.memoryPanel.advisor.unsupported")}
          </div>
        </div>
        <label className="memory-switch">
          <input type="checkbox" checked={enabled} disabled={busy || !supported} onChange={(event) => void onPatch({ enabled: event.target.checked })} />
          <span>{enabled ? t("members.memoryPanel.advisor.enabled") : t("members.memoryPanel.advisor.disabled")}</span>
        </label>
        <button className="joinbtn" disabled={busy || !enabled || !supported} onClick={() => void onPatch({ paused: !paused })}>
          {paused ? t("members.memoryPanel.advisor.resume") : t("members.memoryPanel.advisor.pause")}
        </button>
      </div>
      {!supported ? <div className="memory-advisor-notice">{state.support.reason || t("members.memoryPanel.advisor.isolationRequired")}</div> : null}
      <div className="memory-advisor-facts">
        <span>{t("members.memoryPanel.advisor.pending", { count: pending })}</span>
        <span>{t("members.memoryPanel.advisor.latest", { status: latest?.status || t("members.memoryPanel.never"), time: dateLabel(latest?.completedAt || latest?.createdAt) })}</span>
        <span>{t("members.memoryPanel.advisor.suppressions", { count: activeSuppressions.length })}</span>
      </div>
      {failures[0] ? <div className="memory-advisor-error">
        {t("members.memoryPanel.advisor.lastFailure")}: {failures[0].errorCode || failures[0].status}
        {failures[0].errorDetailRedacted ? ` · ${failures[0].errorDetailRedacted}` : ""}
      </div> : null}
      {activeSuppressions.length ? <details className="memory-suppressions">
        <summary>{t("members.memoryPanel.advisor.manageSuppressions")}</summary>
        {activeSuppressions.map(({ item }) => <div className="memory-suppression-row" key={item.id}>
          <span className="grow">
            <span className="memory-suppression-source"><span className="memory-status">{t(`members.memoryPanel.scope.${item.scope}`, { defaultValue: item.scope || "workspace" })}</span><code>{item.sourceKind}:{item.sourceId}</code></span>
            <small>{dateLabel(item.createdAt)}</small>
          </span>
          <button className="cancel" disabled={busy} onClick={() => void onRevokeSuppression(item.id)}>{t("members.memoryPanel.advisor.allowRelearn")}</button>
        </div>)}
      </details> : null}
    </section>
  );
}
