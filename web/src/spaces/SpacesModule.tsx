import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Folder,
  FolderOpen,
  Link2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useStore, type SpaceInfo } from "../store.tsx";
import { SpaceCreateMenu, type SpaceCreateIntent } from "./SpaceCreateMenu.tsx";
import { SpaceFolderDialog } from "./SpaceFolderDialog.tsx";
import type { SpaceFolderIntent } from "./SpaceFolderForm.tsx";
import "./SpacesModule.css";

type SpacesFlow = SpaceFolderIntent | null;

function statusKey(status: SpaceInfo["status"]) {
  if (status === "missing") return "spacesModule.statusMissing";
  if (status === "error") return "spacesModule.statusError";
  return "spacesModule.statusReady";
}

export function SpacesModule() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { spaces, createSpace, relocateSpace, refreshSpaces } = useStore();
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<SpacesFlow>(null);
  const [relocateTargetId, setRelocateTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");

  const childSpaces = spaces.filter((space) => !space.isHome);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSpaces = normalizedQuery
    ? childSpaces.filter((space) => `${space.name} ${space.rootPath ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
    : childSpaces;

  const resetFlow = () => {
    setFlow(null);
    setRelocateTargetId(null);
    setError("");
  };

  const openCreate = (intent: SpaceCreateIntent) => {
    setRelocateTargetId(null);
    setError("");
    setFlow(intent);
  };

  const openSpace = (space: SpaceInfo) => {
    if (space.status === "ready") {
      navigate(`/s/${space.slug}/channel`);
      return;
    }
    setRelocateTargetId(space.id);
    setError("");
    setFlow("relocate");
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setCatalogError("");
    try {
      await refreshSpaces();
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : t("spacesModule.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  const submit = async (input: { name?: string; rootPath?: string }) => {
    if (!flow || busy) return;
    setBusy(true);
    setError("");
    try {
      let result;
      if (flow === "relocate") {
        if (!relocateTargetId) {
          setError(t("space.operationFailed"));
          return;
        }
        result = await relocateSpace(relocateTargetId, input.rootPath ?? "");
      } else {
        result = await createSpace(input);
      }
      if (!result.space) {
        setError(result.error || t("space.operationFailed"));
        return;
      }
      resetFlow();
      navigate(`/s/${result.space.slug}/channel`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setBusy(false);
    }
  };

  const formatLastOpened = (value?: string) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(i18n.resolvedLanguage || i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="spaces-module">
      <header className="spaces-module__header">
        <div>
          <h1>{t("spacesModule.title")}</h1>
        </div>
        <div className="spaces-module__actions">
          <button type="button" className="spaces-module__action" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? "is-spinning" : undefined} />
            {t("spacesModule.refresh")}
          </button>
          <SpaceCreateMenu onSelect={openCreate} />
        </div>
      </header>

      {catalogError ? <div className="spaces-module__error" role="alert">{catalogError}</div> : null}

      <div className="spaces-module__toolbar">
        <label className="spaces-module__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={t("spacesModule.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("spacesModule.searchPlaceholder")}
          />
        </label>
        <span className="spaces-module__count">{visibleSpaces.length}</span>
      </div>

      {flow ? (
        <SpaceFolderDialog intent={flow} busy={busy} error={error} onCancel={resetFlow} onSubmit={submit} />
      ) : null}

      {visibleSpaces.length > 0 ? (
        <div className="spaces-module__grid">
          {visibleSpaces.map((space) => {
            const ready = space.status === "ready";
            const lastOpened = formatLastOpened(space.lastOpenedAt);
            const StatusIcon = ready ? CheckCircle2 : AlertTriangle;
            return (
              <article key={space.id} className={`spaces-module__card spaces-module__card--${space.status}`}>
                <button type="button" onClick={() => openSpace(space)} aria-label={`${space.name}: ${t(statusKey(space.status))}`}>
                  <span className="spaces-module__card-top">
                    <span className="spaces-module__folder"><Folder size={24} /></span>
                    <span className={`spaces-module__status spaces-module__status--${space.status}`}>
                      <StatusIcon size={13} />
                      {t(statusKey(space.status))}
                    </span>
                  </span>
                  <span className="spaces-module__name">{space.name}</span>
                  <span className="spaces-module__path" title={space.rootPath}>
                    <span>{t("spacesModule.pathLabel")}</span>
                    {space.rootPath || "-"}
                  </span>
                  <span className="spaces-module__last-opened">
                    {lastOpened ? t("spacesModule.lastOpened", { time: lastOpened }) : t("spacesModule.neverOpened")}
                  </span>
                  {!ready && space.rootError ? <span className="spaces-module__root-error">{space.rootError}</span> : null}
                  <span className="spaces-module__card-action">
                    {ready ? t("spacesModule.statusReady") : t("spacesModule.reconnect")}
                    {ready ? <ArrowRight size={15} /> : <Link2 size={15} />}
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="spaces-module__empty">
          <FolderOpen size={28} />
          <h2>{t("spacesModule.emptyTitle")}</h2>
          <p>{t("spacesModule.emptyDescription")}</p>
        </div>
      )}
    </div>
  );
}
