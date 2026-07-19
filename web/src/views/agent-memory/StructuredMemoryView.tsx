import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../Select.tsx";
import { useStore } from "../../store.tsx";
import { useConfirm } from "../../ConfirmModal.tsx";
import { fmtDateTime } from "../../format.ts";
import { MemoryDetailPane } from "./MemoryDetailPane.tsx";
import { MEMORY_KINDS, MEMORY_SCOPES, memoryFreshness, memoryListPath, statusForTab, uniqueKey } from "./memoryPanelModel.ts";
import type {
  MemoryDetail,
  MemoryItem,
  MemoryRevisionMutationAction,
  MemoryRevisionMutationPayload,
  MemoryStatus,
} from "./types.ts";

type StructuredTab = "active" | "proposals" | "archived";

export function StructuredMemoryView({ agentId, onDataChanged, refreshToken = 0 }: {
  agentId: string;
  onDataChanged: () => void;
  refreshToken?: number;
}) {
  const { t } = useTranslation();
  const { api } = useStore();
  const confirm = useConfirm();
  const [tab, setTab] = useState<StructuredTab>("active");
  const [archiveStatus, setArchiveStatus] = useState<MemoryStatus>("archived");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState("");
  const [revokedOnly, setRevokedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: MemoryItem[]; total: number; pageSize: number }>({ items: [], total: 0, pageSize: 25 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const [refresh, setRefresh] = useState(0);

  const status = tab === "archived" ? archiveStatus : statusForTab(tab);
  const listPath = useMemo(() => memoryListPath({
    agentId, status, query: debouncedQuery, kind, scope, sourceAccessRevoked: revokedOnly, page, pageSize: 25,
  }), [agentId, status, debouncedQuery, kind, scope, revokedOnly, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setPage(1);
  }, [agentId]);

  useEffect(() => {
    const request = ++listRequest.current;
    setLoading(true);
    setError("");
    void api("GET", listPath).then((result) => {
      if (request !== listRequest.current) return;
      if (result?.error) {
        setError(result.error);
        setData({ items: [], total: 0, pageSize: 25 });
      } else {
        setData({ items: Array.isArray(result?.items) ? result.items : [], total: Number(result?.total || 0), pageSize: Number(result?.pageSize || 25) });
      }
    }).catch((reason) => {
      if (request === listRequest.current) setError(String(reason?.message || reason));
    }).finally(() => {
      if (request === listRequest.current) setLoading(false);
    });
  }, [listPath, refresh, refreshToken]);

  useEffect(() => {
    const request = ++detailRequest.current;
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    void api("GET", `/api/memories/${selectedId}?ownerAgentId=${encodeURIComponent(agentId)}`).then((result) => {
      if (request !== detailRequest.current) return;
      if (result?.error) setError(result.error);
      else setDetail(result);
    }).catch((reason) => {
      if (request === detailRequest.current) setError(String(reason?.message || reason));
    }).finally(() => {
      if (request === detailRequest.current) setDetailLoading(false);
    });
  }, [agentId, selectedId, refresh, refreshToken]);

  const changeTab = (next: StructuredTab) => {
    setTab(next);
    setPage(1);
    setSelectedId(null);
  };
  const setFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const refreshData = (leftCurrentFilter = false) => {
    if (leftCurrentFilter) setSelectedId(null);
    setRefresh((value) => value + 1);
    onDataChanged();
  };
  const action = async (name: "accept" | "reject" | "archive" | "restore" | "retain_independent" | "delete" | "forget_suppress") => {
    if (!detail) return;
    if (name === "retain_independent" || name === "delete" || name === "forget_suppress") {
      const accepted = await confirm({
        title: t(`members.memoryPanel.confirm.${name}Title`),
        message: t(`members.memoryPanel.confirm.${name}Message`),
        confirmLabel: t(`members.memoryPanel.actions.${name === "delete" ? "deleteItem" : name === "forget_suppress" ? "forgetSuppress" : "retainIndependent"}`),
        danger: name !== "retain_independent",
      });
      if (!accepted) return;
    }
    setBusy(true);
    setError("");
    try {
      const result = name === "accept" || name === "reject"
        ? await api("POST", `/api/memories/${detail.memory.id}/${name}`, { idempotencyKey: uniqueKey(`proposal-${name}`) })
        : await api("POST", `/api/memories/${detail.memory.id}/mutate`, {
          schemaVersion: 1,
          action: name,
          expectedRevision: detail.memory.currentRevision,
          idempotencyKey: uniqueKey(`memory-${name}`),
          payload: {},
        });
      if (result?.error) setError(result.error);
      else refreshData(true);
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setBusy(false);
    }
  };
  const revise = async (name: MemoryRevisionMutationAction, payload: MemoryRevisionMutationPayload): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    setError("");
    try {
      const result = await api("POST", `/api/memories/${detail.memory.id}/mutate`, {
        schemaVersion: 1,
        action: name,
        expectedRevision: detail.memory.currentRevision,
        idempotencyKey: uniqueKey(`memory-${name}`),
        payload,
      });
      if (result?.error) {
        setError(result.error);
        return false;
      }
      refreshData();
      return true;
    } catch (reason: any) {
      setError(String(reason?.message || reason));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const kindOptions = MEMORY_KINDS.map((value) => ({ value, label: value ? t(`members.memoryPanel.kind.${value}`) : t("members.memoryPanel.filters.allKinds") }));
  const scopeOptions = MEMORY_SCOPES.map((value) => ({ value, label: value ? t(`members.memoryPanel.scope.${value}`) : t("members.memoryPanel.filters.allScopes") }));

  return (
    <div className="structured-memory">
      <div className="memory-toolbar">
        <div className="memory-status-tabs" role="tablist">
          {(["active", "proposals", "archived"] as const).map((value) => <button role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} key={value} onClick={() => changeTab(value)}>{t(`members.memoryPanel.tabs.${value}`)}</button>)}
        </div>
        <label className="memory-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("members.memoryPanel.filters.search")} /></label>
        <Select value={kind} options={kindOptions} onChange={(value) => setFilter(setKind, value)} ariaLabel={t("members.memoryPanel.filters.kind")} />
        <Select value={scope} options={scopeOptions} onChange={(value) => setFilter(setScope, value)} ariaLabel={t("members.memoryPanel.filters.scope")} />
        {tab === "archived" ? <Select value={archiveStatus} options={(["archived", "superseded", "rejected"] as const).map((value) => ({ value, label: t(`members.memoryPanel.status.${value}`) }))} onChange={(value) => { setArchiveStatus(value as MemoryStatus); setPage(1); }} ariaLabel={t("members.memoryPanel.filters.status")} /> : null}
        <label className="memory-revoked-filter"><input type="checkbox" checked={revokedOnly} onChange={(event) => { setRevokedOnly(event.target.checked); setPage(1); }} />{t("members.memoryPanel.filters.revoked")}</label>
      </div>
      {error ? <div className="memory-panel-error">{error}</div> : null}
      <div className="memory-browser">
        <div className="memory-list-pane">
          {loading ? <div className="empty">{t("members.loading")}</div>
            : data.items.length === 0 ? <div className="empty">{t("members.memoryPanel.empty")}</div>
              : data.items.map((item) => {
                const freshness = memoryFreshness(item);
                return <button className={`memory-list-item${selectedId === item.memory.id ? " active" : ""}`} key={item.memory.id} onClick={() => setSelectedId(item.memory.id)}>
                  <span className="memory-list-title">{item.revision.canonicalText}</span>
                  <span className="memory-list-badges">
                    <span className="memory-status">{t(`members.memoryPanel.scope.${item.memory.scope}`, { defaultValue: item.memory.scope })}</span>
                    <span className="memory-status">{t(`members.memoryPanel.kind.${item.memory.kind}`, { defaultValue: item.memory.kind })}</span>
                    <span className={`memory-status memory-status-${item.memory.status}`}>{t(`members.memoryPanel.status.${item.memory.status}`, { defaultValue: item.memory.status })}</span>
                  </span>
                  <span className="memory-list-meta">
                    {t("members.memoryPanel.evidenceCount", { count: item.evidenceCount ?? item.evidence.length })}
                    {item.inContinuityBundle ? ` · ${t("members.memoryPanel.continuity")}` : ""}
                    {` · ${t(`members.memoryPanel.freshness.${freshness}`)}`}
                  </span>
                  <span className="memory-list-meta">{item.lastRecall ? `${item.lastRecall.projection || "—"} · ${fmtDateTime(item.lastRecall.recalledAt as any)}` : t("members.memoryPanel.neverRecalled")}</span>
                  {item.replacement ? <span className="memory-replacement">{item.replacement.relationType} → {item.replacement.memoryId}</span> : null}
                </button>;
              })}
          <div className="memory-pagination">
            <button className="cancel" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("members.memoryPanel.previous")}</button>
            <span>{t("members.memoryPanel.page", { page, pages, total: data.total })}</span>
            <button className="cancel" disabled={page >= pages || loading} onClick={() => setPage((value) => Math.min(pages, value + 1))}>{t("members.memoryPanel.next")}</button>
          </div>
        </div>
        <div className="memory-detail-pane">
          {detailLoading ? <div className="empty">{t("members.loading")}</div> : <MemoryDetailPane detail={detail} busy={busy} onAction={action} onRevise={revise} />}
        </div>
      </div>
    </div>
  );
}
