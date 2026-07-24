import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  revisionDraftIssue,
  revisionMutationPayload,
  type MemoryRevisionDraft,
} from "./memoryPanelModel.ts";
import type {
  MemoryRevision,
  MemoryRevisionMutationAction,
  MemoryRevisionMutationPayload,
} from "./types.ts";

export function MemoryRevisionEditor({ revision, busy, onSubmit }: {
  revision: MemoryRevision;
  busy: boolean;
  onSubmit: (action: MemoryRevisionMutationAction, payload: MemoryRevisionMutationPayload) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<MemoryRevisionMutationAction | null>(null);
  const [draft, setDraft] = useState<MemoryRevisionDraft>(() => ({
    canonicalText: revision.canonicalText,
    internalSummary: revision.internalSummary ?? "",
    shareableSummary: revision.shareableSummary ?? "",
    replacementMemoryId: "",
    relationType: "",
  }));

  const issue = action ? revisionDraftIssue(action, draft) : null;
  const update = <K extends keyof MemoryRevisionDraft>(key: K, value: MemoryRevisionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const submit = async () => {
    if (!action || issue) return;
    if (await onSubmit(action, revisionMutationPayload(action, draft))) setAction(null);
  };

  return (
    <section className="memory-revision-editor">
      <div className="memory-revision-editor-tabs">
        <button className={action === "edit" ? "on" : "cancel"} disabled={busy} onClick={() => setAction(action === "edit" ? null : "edit")}>
          {t("members.memoryPanel.actions.edit")}
        </button>
        <button className={action === "correct" ? "on" : "cancel"} disabled={busy} onClick={() => setAction(action === "correct" ? null : "correct")}>
          {t("members.memoryPanel.actions.correct")}
        </button>
      </div>
      {action ? <div className="memory-revision-form">
        <label>
          <span>{t("members.memoryPanel.editor.canonicalText")}</span>
          <textarea value={draft.canonicalText} onChange={(event) => update("canonicalText", event.target.value)} rows={4} />
        </label>
        <label>
          <span>{t("members.memoryPanel.editor.internalSummary")}</span>
          <textarea value={draft.internalSummary} onChange={(event) => update("internalSummary", event.target.value)} rows={2} />
        </label>
        <label>
          <span>{t("members.memoryPanel.editor.shareableSummary")}</span>
          <textarea value={draft.shareableSummary} onChange={(event) => update("shareableSummary", event.target.value)} rows={2} />
        </label>
        {action === "correct" ? <div className="memory-replacement-fields">
          <label>
            <span>{t("members.memoryPanel.editor.replacementMemoryId")}</span>
            <input value={draft.replacementMemoryId} onChange={(event) => update("replacementMemoryId", event.target.value)} placeholder={t("members.memoryPanel.editor.optionalReplacement")} />
          </label>
          <label>
            <span>{t("members.memoryPanel.editor.relationType")}</span>
            <select value={draft.relationType} onChange={(event) => update("relationType", event.target.value as MemoryRevisionDraft["relationType"])}>
              <option value="">{t("members.memoryPanel.editor.noRelation")}</option>
              <option value="supersedes">supersedes</option>
              <option value="contradicts">contradicts</option>
            </select>
          </label>
        </div> : null}
        {issue ? <div className="memory-editor-error">{t(`members.memoryPanel.editor.${issue}`)}</div> : null}
        <div className="memory-revision-editor-actions">
          <button className="ok" disabled={busy || Boolean(issue)} onClick={() => void submit()}>{t("members.memoryPanel.editor.saveRevision")}</button>
          <button className="cancel" disabled={busy} onClick={() => setAction(null)}>{t("members.cancel")}</button>
        </div>
      </div> : null}
    </section>
  );
}
