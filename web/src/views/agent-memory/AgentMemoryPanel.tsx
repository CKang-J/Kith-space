import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store.tsx";
import { AdvisorStatusCard } from "./AdvisorStatusCard.tsx";
import { StructuredMemoryView } from "./StructuredMemoryView.tsx";
import { hasPendingAdvisorJobs } from "./memoryPanelModel.ts";
import type { AdvisorJob, AdvisorState, SuppressionRecord } from "./types.ts";

const FilesMemoryView = lazy(() => import("./FilesMemoryView.tsx").then((module) => ({ default: module.FilesMemoryView })));

export function AgentMemoryPanel({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  const controlRequest = useRef(0);
  const [view, setView] = useState<"structured" | "files">("structured");
  const [advisor, setAdvisor] = useState<AdvisorState | null>(null);
  const [jobs, setJobs] = useState<AdvisorJob[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionRecord[]>([]);
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const [structuredRefresh, setStructuredRefresh] = useState(0);
  const [error, setError] = useState("");

  const loadControlPlane = useCallback(async (): Promise<"pending" | "settled" | "stale" | "error"> => {
    const request = ++controlRequest.current;
    try {
      const [nextAdvisor, nextJobs, nextSuppressions] = await Promise.all([
        apiRef.current("GET", `/api/agents/${agentId}/memory-advisor`),
        apiRef.current("GET", `/api/memory-advisor/jobs?agentId=${encodeURIComponent(agentId)}`),
        apiRef.current("GET", `/api/memories/suppressions?ownerAgentId=${encodeURIComponent(agentId)}`),
      ]);
      if (request !== controlRequest.current) return "stale";
      if (nextAdvisor?.error) throw new Error(nextAdvisor.error);
      const nextJobItems = Array.isArray(nextJobs?.items) ? nextJobs.items : [];
      setAdvisor(nextAdvisor);
      setJobs(nextJobItems);
      setSuppressions(Array.isArray(nextSuppressions?.items) ? nextSuppressions.items : []);
      setStructuredRefresh((value) => value + 1);
      setError("");
      return hasPendingAdvisorJobs(nextJobItems) ? "pending" : "settled";
    } catch (reason: any) {
      if (request === controlRequest.current) setError(String(reason?.message || reason));
      return "error";
    }
  }, [agentId]);

  useEffect(() => {
    setAdvisor(null);
    setJobs([]);
    setSuppressions([]);
    void loadControlPlane();
  }, [loadControlPlane]);

  const hasPendingJobs = hasPendingAdvisorJobs(jobs);
  useEffect(() => {
    if (!hasPendingJobs) return;
    let cancelled = false;
    let timer = 0;
    let consecutiveFailures = 0;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        const result = await loadControlPlane();
        if (cancelled) return;
        if (result === "error") consecutiveFailures += 1;
        else consecutiveFailures = 0;
        if (result !== "settled" && consecutiveFailures < 5) schedule();
      }, 3_000);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingJobs, loadControlPlane]);

  const patchAdvisor = async (patch: { enabled?: boolean; paused?: boolean }) => {
    setAdvisorBusy(true);
    try {
      const result = await apiRef.current("PATCH", `/api/agents/${agentId}/memory-advisor`, patch);
      if (result?.error) throw new Error(result.error);
      setAdvisor(result);
      setError("");
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setAdvisorBusy(false);
    }
  };
  const revokeSuppression = async (id: string) => {
    setAdvisorBusy(true);
    try {
      const result = await apiRef.current("POST", `/api/memories/suppressions/${encodeURIComponent(id)}/revoke`);
      if (result?.error) throw new Error(result.error);
      await loadControlPlane();
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setAdvisorBusy(false);
    }
  };

  return (
    <div className="agent-memory-panel">
      <div className="agent-memory-view-tabs" role="tablist">
        <button role="tab" aria-selected={view === "structured"} className={view === "structured" ? "on" : ""} onClick={() => setView("structured")}>{t("members.memoryPanel.structured")}</button>
        <button role="tab" aria-selected={view === "files"} className={view === "files" ? "on" : ""} onClick={() => setView("files")}>{t("members.memoryPanel.files")}</button>
      </div>
      {view === "structured" ? <>
        <AdvisorStatusCard state={advisor} jobs={jobs} suppressions={suppressions} busy={advisorBusy} onPatch={patchAdvisor} onRevokeSuppression={revokeSuppression} />
        {error ? <div className="memory-panel-error">{error}</div> : null}
        <StructuredMemoryView agentId={agentId} refreshToken={structuredRefresh} onDataChanged={() => void loadControlPlane()} />
      </> : <Suspense fallback={<div className="empty">{t("members.loading")}</div>}><FilesMemoryView agentId={agentId} /></Suspense>}
    </div>
  );
}
