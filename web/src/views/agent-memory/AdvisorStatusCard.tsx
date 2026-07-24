import { useEffect, useState } from "react";
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
  onConsent,
  onRevokeConsent,
}: {
  state: AdvisorState | null;
  jobs: AdvisorJob[];
  suppressions: SuppressionRecord[];
  busy: boolean;
  onPatch: (patch: { enabled?: boolean; paused?: boolean }) => Promise<void>;
  onRevokeSuppression: (id: string) => Promise<void>;
  onConsent: (scope: { public: boolean; private: boolean; dm: boolean }) => Promise<void>;
  onRevokeConsent: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const scope = state?.settings.consentSourceScope || { public: true, private: false, dm: false };
  const [draftScope, setDraftScope] = useState(scope);
  useEffect(() => { setDraftScope(scope); }, [scope.public, scope.private, scope.dm]);
  if (!state) return <section className="memory-advisor-card"><span className="meta">{t("members.loading")}</span></section>;
  const enabled = Boolean(state.settings.enabled);
  const paused = Boolean(state.settings.pausedAt);
  const supported = state.support.toolIsolation === "enforced";
  const latest = state.latestJob;
  const pending = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failures = jobs.filter((job) => job.status === "failed" || job.status === "blocked");
  const activeSuppressions = suppressions.filter(({ item }) => item.status === "active");
  const system = state.systemProvider;
  const consented = Boolean(system?.provider && system?.modelProfile
    && state.settings.consentPurpose === "memory_advisor_v1"
    && state.settings.approvedProviderRevision === system.provider.revision
    && state.settings.approvedModelProfileRevision === system.modelProfile.revision
    && state.settings.approvedProviderEpoch === system.settings.providerEpoch
    && state.settings.providerEpochMirror === system.settings.providerEpoch
    && state.settings.installationIdentityDigest === system.settings.installationIdentityDigest
    && Boolean(state.settings.approvedEgressDigest));
  const profile = system?.modelProfile?.profile;

  return (
    <section className="memory-advisor-card" aria-label={t("members.memoryPanel.advisor.title")}>
      <div className="memory-advisor-head">
        <div>
          <div className="who">{t("members.memoryPanel.advisor.title")}</div>
          <div className="meta">
            {system?.settings.executionMode === "provider_v1" && system.provider
              ? `${system.provider.adapterId}@${system.provider.adapterVersion} · ${system.modelProfile?.profile.backendId || "—"}/${system.modelProfile?.profile.modelId || "—"}`
              : `${state.runtime} · ${supported ? t("members.memoryPanel.advisor.available") : t("members.memoryPanel.advisor.unsupported")}`}
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
      {system?.settings.executionMode === "provider_v1" ? <div className="memory-advisor-consent">
        <div className="meta">{consented ? t("members.memoryPanel.advisor.consentActive") : t("members.memoryPanel.advisor.consentRequired")}</div>
        <div className="memory-consent-scopes">
          {(["public", "private", "dm"] as const).map((key) => <label key={key}>
            <input type="checkbox" checked={draftScope[key]} disabled={busy}
              onChange={(event) => setDraftScope((current) => ({ ...current, [key]: event.target.checked }))} />
            {t(`members.memoryPanel.advisor.${key}Scope`)}
          </label>)}
        </div>
        {profile ? <div className="meta">
          {profile.canonicalOrigin} · {profile.credentialIdentityDigest.slice(0, 12)} · {profile.dataPolicyRevision} ({profile.dataPolicyProvenance}) · {profile.allowedEgress.join(", ")}
        </div> : null}
        <div className="meta">{t("members.memoryPanel.advisor.revocationNotice")}</div>
        <div className="setrow">
          <button className="joinbtn" disabled={busy || !supported || !Object.values(draftScope).some(Boolean)} onClick={() => void onConsent(draftScope)}>{consented ? t("members.memoryPanel.advisor.renewConsent") : t("members.memoryPanel.advisor.grantConsent")}</button>
          <button className="cancel" disabled={busy || !consented} onClick={() => void onRevokeConsent()}>{t("members.memoryPanel.advisor.revokeConsent")}</button>
        </div>
      </div> : null}
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
