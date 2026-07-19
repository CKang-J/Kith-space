import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../format.ts";
import { useStore } from "../../store.tsx";
import { memoryEvidencePath, normalizedConfidence } from "./memoryPanelModel.ts";
import { MemoryRevisionEditor } from "./MemoryRevisionEditor.tsx";
import type {
  MemoryDetail,
  MemoryRevisionMutationAction,
  MemoryRevisionMutationPayload,
} from "./types.ts";

function dateLabel(value: string | number | null | undefined): string {
  return value == null ? "—" : fmtDateTime(value as any);
}

function Actor({ actor }: { actor?: { type: string; id: string } }) {
  return actor ? <code>{actor.type}:{actor.id}</code> : <>—</>;
}

export function MemoryDetailPane({ detail, busy, onAction, onRevise }: {
  detail: MemoryDetail | null;
  busy: boolean;
  onAction: (action: "accept" | "reject" | "archive" | "restore" | "retain_independent" | "delete" | "forget_suppress") => Promise<void>;
  onRevise: (action: MemoryRevisionMutationAction, payload: MemoryRevisionMutationPayload) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { slug } = useStore();
  if (!detail) return <div className="memory-detail-empty">{t("members.memoryPanel.selectHint")}</div>;
  const { memory, revision } = detail;
  const confidence = Math.round(normalizedConfidence(memory.confidence) * 100);
  const showProposalActions = memory.status === "proposed";
  return (
    <article className="memory-detail">
      <header className="memory-detail-head">
        <div>
          <div className="memory-detail-id">{memory.id}</div>
          <h3>{revision.canonicalText}</h3>
        </div>
        <span className={`memory-status memory-status-${memory.status}`}>{t(`members.memoryPanel.status.${memory.status}`, { defaultValue: memory.status })}</span>
      </header>
      <div className="memory-detail-actions">
        {showProposalActions ? <>
          <button className="ok" disabled={busy} onClick={() => void onAction("accept")}>{t("members.memoryPanel.actions.accept")}</button>
          <button className="cancel" disabled={busy} onClick={() => void onAction("reject")}>{t("members.memoryPanel.actions.reject")}</button>
        </> : null}
        {memory.status === "active" ? <button className="cancel" disabled={busy} onClick={() => void onAction("archive")}>{t("members.memoryPanel.actions.archive")}</button> : null}
        {memory.status === "archived" ? <button className="cancel" disabled={busy} onClick={() => void onAction("restore")}>{t("members.memoryPanel.actions.restore")}</button> : null}
        {memory.status === "active" && memory.sourceAccess !== "available" ? <button className="ok" disabled={busy} onClick={() => void onAction("retain_independent")}>{t("members.memoryPanel.actions.retainIndependent")}</button> : null}
        <button className="cancel memory-danger" disabled={busy} onClick={() => void onAction("delete")}>{t("members.memoryPanel.actions.deleteItem")}</button>
        <button className="cancel memory-danger" disabled={busy} onClick={() => void onAction("forget_suppress")}>{t("members.memoryPanel.actions.forgetSuppress")}</button>
      </div>

      {!showProposalActions ? <MemoryRevisionEditor
        key={`${memory.id}:${memory.currentRevision}`}
        revision={revision}
        busy={busy}
        onSubmit={onRevise}
      /> : null}

      <section className="memory-detail-grid">
        <div><b>{t("members.memoryPanel.fields.scope")}</b><span>{t(`members.memoryPanel.scope.${memory.scope}`, { defaultValue: memory.scope })}</span></div>
        <div><b>{t("members.memoryPanel.fields.kind")}</b><span>{t(`members.memoryPanel.kind.${memory.kind}`, { defaultValue: memory.kind })}</span></div>
        <div><b>{t("members.memoryPanel.fields.disclosure")}</b><span>{t(`members.memoryPanel.disclosure.${revision.disclosure}`, { defaultValue: revision.disclosure })}</span></div>
        <div><b>{t("members.memoryPanel.fields.confidence")}</b><span>{confidence}%</span></div>
        <div><b>{t("members.memoryPanel.fields.validity")}</b><span>{dateLabel(revision.validFrom)} – {dateLabel(revision.validTo)}</span></div>
        <div><b>{t("members.memoryPanel.fields.sourceAccess")}</b><span>{t(`members.memoryPanel.sourceAccess.${memory.sourceAccess}`, { defaultValue: memory.sourceAccess })}</span></div>
        <div><b>{t("members.memoryPanel.fields.createdBy")}</b><span><Actor actor={memory.createdBy} /></span></div>
        <div><b>{t("members.memoryPanel.fields.updatedBy")}</b><span><Actor actor={memory.updatedBy} /></span></div>
      </section>

      {revision.internalSummary || revision.shareableSummary ? <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.projections")}</h4>
        {revision.internalSummary ? <p><b>{t("members.memoryPanel.fields.internalSummary")}</b>{revision.internalSummary}</p> : null}
        {revision.shareableSummary ? <p><b>{t("members.memoryPanel.fields.shareableSummary")}</b>{revision.shareableSummary}</p> : null}
      </section> : null}

      <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.evidence")} <span className="cnt">{detail.evidence.length}</span></h4>
        {detail.evidence.length ? detail.evidence.map((item) => {
          const sourcePath = memoryEvidencePath({
            slug,
            sourceKind: item.sourceKind,
            sourceId: item.sourceId,
            sourceSurfaceId: item.sourceSurfaceId,
            sourceAccess: memory.sourceAccess,
          });
          return <div className="memory-evidence" key={item.id}>
          {sourcePath
            ? <Link className="memory-evidence-link" to={sourcePath}><code>{item.sourceKind}:{item.sourceId}</code></Link>
            : <code>{item.sourceKind}:{item.sourceId}</code>}
          <span>{item.visibilityAtOccurrence} · {item.claimType} · {item.memoryPolicy}</span>
          <small>{item.sourceSurfaceId || "—"} · {dateLabel(item.occurredAt)}</small>
        </div>;
        }) : <div className="meta">—</div>}
      </section>

      <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.revisions")} <span className="cnt">{detail.revisionHistory.length}</span></h4>
        {detail.revisionHistory.map((item) => <details key={item.revision} className="memory-revision" open={item.revision === memory.currentRevision}>
          <summary>v{item.revision} · {dateLabel(item.createdAt)} · <Actor actor={item.createdBy} /></summary>
          <p>{item.canonicalText}</p>
        </details>)}
      </section>

      <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.relations")}</h4>
        {detail.relations.length ? detail.relations.map((item) => <div className="memory-relation" key={item.id || `${item.fromMemoryId}:${item.toMemoryId}:${item.relationType}`}>
          <span className="memory-status">{item.relationType}</span>
          <code>{item.fromMemoryId}@{item.fromRevision} → {item.toMemoryId}@{item.toRevision}</code>
        </div>) : <div className="meta">—</div>}
      </section>

      <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.advisorJob")}</h4>
        {detail.advisorJob ? <div className="memory-job-detail">
          <span className={`memory-status memory-status-${detail.advisorJob.status}`}>{detail.advisorJob.status}</span>
          <code>{detail.advisorJob.id}</code>
          <span>{detail.advisorJob.provider}{detail.advisorJob.model ? ` · ${detail.advisorJob.model}` : ""}</span>
          {detail.advisorJob.validation ? <span>{t("members.memoryPanel.advisor.validation", detail.advisorJob.validation)}</span> : null}
          {detail.advisorJob.errorCode ? <span className="memory-advisor-error">{detail.advisorJob.errorCode} · {detail.advisorJob.errorDetailRedacted}</span> : null}
        </div> : <div className="meta">{t("members.memoryPanel.manualMemory")}</div>}
      </section>

      <section className="memory-detail-section">
        <h4>{t("members.memoryPanel.fields.recalls")} <span className="cnt">{detail.recalls.length}</span></h4>
        {detail.recalls.length ? detail.recalls.map((item, index) => <div className="memory-recall" key={`${item.targetSurfaceId}:${index}`}>
          <span>{dateLabel(item.recalledAt)} · {item.projection || "—"}</span>
          <code>{item.targetSurfaceId || t("members.memoryPanel.unknownSurface")}</code>
          <small>{item.reasons?.join(" · ") || "—"}</small>
        </div>) : <div className="meta">{t("members.memoryPanel.neverRecalled")}</div>}
      </section>
    </article>
  );
}
