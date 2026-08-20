import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PanelsTopLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../../store.tsx";
import { CanvasTurnSourceCard, canvasTurnOpenLocation } from "./CanvasTurnSourceCard.tsx";

type TurnDetails = {
  turn: { id: string; status: string; outcome?: string | null; directive: string; agent?: { displayName: string } | null; session?: { surfaceKind: string; surfaceId: string; generation: number; runtime: string; status: string } | null };
  context: { manifestState: string; envelope?: { continuityMode?: string; budget?: { available: number; used: number; estimator: string }; omissions?: unknown[] } | null; sources: Array<{ phase: string; ordinal: number; sourceKind: string; sourceId: string; state: string; injectionMode: string; projection: string; reason: string; estimatedTokens: number; content?: unknown }> };
  attempts: Array<{ id: string; number: number; status: string; workerGeneration: number; usage?: unknown; errorCode?: string | null; errorDetail?: string | null; events: Array<{ ordinal: number; kind: string; payload: unknown }> }>;
  obligations: Array<{ id: string; directive: string; disposition: string; reason: string; sourceSeq: number; sourceState: string; message?: { senderName: string; content: string } | null }>;
  operations: Array<{ id: string; toolName: string; status: string; slot: string; errorCode?: string | null }>;
  outputs: Array<{ id: string; kind: string; messageId?: string | null; sourceState: string; handledInputIds: string[] }>;
};

type Tab = "context" | "steps" | "usage" | "outcome";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function TurnDetailsButton({ turnId }: { turnId: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("context");
  const [data, setData] = useState<TurnDetails | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || data) return;
    let live = true;
    api("GET", `/api/turns/${turnId}`).then((result) => {
      if (!live) return;
      if (result?.error) setError(String(result.error));
      else setData(result as TurnDetails);
    }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, [api, data, open, turnId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <button type="button" title={t("chat.turnDetails")} aria-label={t("chat.turnDetails")} onClick={() => setOpen(true)}>
        <PanelsTopLeft size={15} />
      </button>
      {open ? createPortal(
        <div className="turn-details-backdrop" onMouseDown={() => setOpen(false)}>
          <aside className="turn-details-panel" role="dialog" aria-modal="true" aria-label={t("chat.turnDetails")} onMouseDown={(event) => event.stopPropagation()}>
            <header className="turn-details-head">
              <div><strong>{t("chat.turnDetails")}</strong><span>{data?.turn.agent?.displayName ?? turnId.slice(0, 8)}</span></div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("chat.close")}><X size={17} /></button>
            </header>
            <nav className="turn-details-tabs" aria-label={t("chat.turnDetails")}>
              {(["context", "steps", "usage", "outcome"] as Tab[]).map((item) => (
                <button type="button" key={item} className={tab === item ? "on" : ""} onClick={() => setTab(item)}>{t(`chat.turnDetailsTabs.${item}`)}</button>
              ))}
            </nav>
            <div className="turn-details-body">
              {!data && !error ? <div className="turn-details-empty">{t("chat.turnLoading")}</div> : null}
              {error ? <div className="turn-details-error">{error}</div> : null}
              {data && tab === "context" ? <>
                <div className="turn-details-summary">
                  <span>{data.context.manifestState}</span>
                  <span>{data.context.envelope?.continuityMode ?? "—"}</span>
                  <span>{data.context.envelope?.budget ? `${data.context.envelope.budget.used}/${data.context.envelope.budget.available} tokens` : "—"}</span>
                </div>
                {data.context.sources.map((source) => source.sourceKind === "canvas_selection_snapshot"
                  ? (
                    <CanvasTurnSourceCard
                      key={`${source.phase}:${source.ordinal}`}
                      source={source}
                      t={t}
                      onOpen={(canvasId, canvasTitle) => navigate(canvasTurnOpenLocation(location.pathname, location.search, canvasId, canvasTitle))}
                    />
                  )
                  : (
                    <section className="turn-details-card" key={`${source.phase}:${source.ordinal}`}>
                      <div className="turn-details-card-head"><strong>{source.sourceKind}</strong><span className={`turn-source-state is-${source.state}`}>{source.state}</span></div>
                      <div className="turn-details-meta">{source.reason} · {source.injectionMode} · {source.projection} · ~{source.estimatedTokens} tokens</div>
                      <code>{source.sourceId}</code>
                      {source.content != null ? <pre>{typeof source.content === "string" ? source.content : json(source.content)}</pre> : null}
                    </section>
                  ))}
              </> : null}
              {data && tab === "steps" ? data.attempts.map((attempt) => <section className="turn-details-card" key={attempt.id}>
                <div className="turn-details-card-head"><strong>{t("chat.turnAttempt", { number: attempt.number })}</strong><span>{attempt.status}</span></div>
                <div className="turn-details-meta">worker generation {attempt.workerGeneration}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</div>
                {attempt.events.length ? <ol className="turn-event-list">{attempt.events.map((event) => <li key={`${attempt.id}:${event.ordinal}`}><strong>{event.kind}</strong><pre>{json(event.payload)}</pre></li>)}</ol> : <div className="turn-details-empty">{t("chat.turnNoEvents")}</div>}
              </section>) : null}
              {data && tab === "usage" ? <>
                {data.attempts.map((attempt) => <section className="turn-details-card" key={attempt.id}><div className="turn-details-card-head"><strong>{t("chat.turnAttempt", { number: attempt.number })}</strong><span>{attempt.status}</span></div><pre>{json(attempt.usage ?? {})}</pre></section>)}
              </> : null}
              {data && tab === "outcome" ? <>
                <div className="turn-details-summary"><span>{data.turn.directive}</span><span>{data.turn.status}</span><span>{data.turn.outcome ?? "—"}</span></div>
                <h4>{t("chat.turnObligations")}</h4>
                {data.obligations.map((item) => <section className="turn-details-card" key={item.id}><div className="turn-details-card-head"><strong>{item.directive}</strong><span>{item.disposition}</span></div><div className="turn-details-meta">seq {item.sourceSeq} · {item.reason} · {item.sourceState}</div>{item.message ? <pre>{item.message.senderName}: {item.message.content}</pre> : null}</section>)}
                <h4>{t("chat.turnOperations")}</h4>
                {data.operations.map((item) => <section className="turn-details-card" key={item.id}><div className="turn-details-card-head"><strong>{item.toolName}</strong><span>{item.status}</span></div><div className="turn-details-meta">{item.slot}{item.errorCode ? ` · ${item.errorCode}` : ""}</div></section>)}
                <h4>{t("chat.turnOutputs")}</h4>
                {data.outputs.map((item) => <section className="turn-details-card" key={item.id}><div className="turn-details-card-head"><strong>{item.kind}</strong><span>{item.sourceState}</span></div><div className="turn-details-meta">{item.handledInputIds.length} inputs · {item.messageId ?? "no message"}</div></section>)}
              </> : null}
            </div>
          </aside>
        </div>, document.body) : null}
    </>
  );
}
