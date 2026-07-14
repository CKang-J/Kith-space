import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Folder,
  FolderOpen,
  Link2,
  RefreshCw,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SearchField } from "../components/SearchField.tsx";
import { useConfirm } from "../ConfirmModal.tsx";
import { copyText } from "../clipboard.ts";
import { getDesktopBridge } from "../desktopBridge.ts";
import { useStore, type SpaceInfo } from "../store.tsx";
import { useToast } from "../toast.tsx";
import { SpaceCardMenu } from "./SpaceCardMenu.tsx";
import { SpaceCreateMenu, type SpaceCreateIntent } from "./SpaceCreateMenu.tsx";
import { SpaceFolderDialog } from "./SpaceFolderDialog.tsx";
import type { SpaceFolderIntent } from "./SpaceFolderForm.tsx";
import { SpaceRenameDialog } from "./SpaceRenameDialog.tsx";
import "./SpacesModule.css";

type SpacesFlow = SpaceFolderIntent | null;
const FAVORITE_SPACES_KEY = "kith-space.favorite-spaces";

function storedFavoriteSpaces(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITE_SPACES_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function persistFavoriteSpaces(ids: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITE_SPACES_KEY, JSON.stringify([...ids]));
  } catch {
    // Favorites are a local UI preference; keep the in-memory state when storage is unavailable.
  }
}

function statusKey(status: SpaceInfo["status"]) {
  if (status === "missing") return "spacesModule.statusMissing";
  if (status === "error") return "spacesModule.statusError";
  return "spacesModule.statusReady";
}

export function SpacesModule() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const desktopBridge = getDesktopBridge();
  const { spaces, createSpace, relocateSpace, renameSpace, removeSpace, refreshSpaces } = useStore();
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<SpacesFlow>(null);
  const [relocateTargetId, setRelocateTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [renameTarget, setRenameTarget] = useState<SpaceInfo | null>(null);
  const [spaceActionBusy, setSpaceActionBusy] = useState(false);
  const [spaceActionError, setSpaceActionError] = useState("");
  const [favoriteIds, setFavoriteIds] = useState(storedFavoriteSpaces);

  const childSpaces = [...spaces.filter((space) => !space.isHome)]
    .sort((a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)));
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

  const toggleFavorite = (spaceId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      persistFavoriteSpaces(next);
      return next;
    });
  };

  const copySpacePath = async (space: SpaceInfo) => {
    if (!space.rootPath) return;
    if (await copyText(space.rootPath)) toast.info(t("spacesModule.pathCopied"));
    else setCatalogError(t("spacesModule.copyPathFailed"));
  };

  const revealSpace = async (space: SpaceInfo) => {
    if (!desktopBridge || !space.rootPath) return;
    try {
      const detail = await desktopBridge.revealSpaceDirectory(space.rootPath);
      if (detail) setCatalogError(detail);
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : t("spacesModule.revealFailed"));
    }
  };

  const submitRename = async (name: string) => {
    if (!renameTarget || spaceActionBusy) return;
    setSpaceActionBusy(true);
    setSpaceActionError("");
    try {
      const result = await renameSpace(renameTarget.id, name);
      if (!result.space) {
        setSpaceActionError(result.error || t("spacesModule.renameFailed"));
        return;
      }
      setRenameTarget(null);
      toast.info(t("spacesModule.renameSuccess"));
    } catch (cause) {
      setSpaceActionError(cause instanceof Error ? cause.message : t("spacesModule.renameFailed"));
    } finally {
      setSpaceActionBusy(false);
    }
  };

  const requestRemove = async (space: SpaceInfo) => {
    const accepted = await confirm({
      title: t("spacesModule.removeConfirmTitle", { name: space.name }),
      message: t("spacesModule.removeConfirmDescription"),
      confirmLabel: t("spacesModule.remove"),
      danger: true,
    });
    if (!accepted) return;
    setCatalogError("");
    try {
      const result = await removeSpace(space.id);
      if (!result.ok) {
        setCatalogError(result.error || t("spacesModule.removeFailed"));
        return;
      }
      setFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(space.id);
        persistFavoriteSpaces(next);
        return next;
      });
      toast.info(t("spacesModule.removeSuccess"));
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : t("spacesModule.removeFailed"));
    }
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
        <SearchField
          className="spaces-module__search"
          value={query}
          onValueChange={setQuery}
          clearLabel={t("spacesModule.clearSearch")}
          aria-label={t("spacesModule.searchPlaceholder")}
          placeholder={t("spacesModule.searchPlaceholder")}
        />
        <span className="spaces-module__count">{visibleSpaces.length}</span>
      </div>

      {flow ? (
        <SpaceFolderDialog intent={flow} busy={busy} error={error} onCancel={resetFlow} onSubmit={submit} />
      ) : null}
      {renameTarget ? (
        <SpaceRenameDialog
          currentName={renameTarget.name}
          busy={spaceActionBusy}
          error={spaceActionError}
          onCancel={() => {
            setRenameTarget(null);
            setSpaceActionError("");
          }}
          onConfirm={(name) => void submitRename(name)}
        />
      ) : null}

      {visibleSpaces.length > 0 ? (
        <div className="spaces-module__grid">
          {visibleSpaces.map((space) => {
            const ready = space.status === "ready";
            const lastOpened = formatLastOpened(space.lastOpenedAt);
            const StatusIcon = ready ? CheckCircle2 : AlertTriangle;
            return (
              <article key={space.id} className={`spaces-module__card spaces-module__card--${space.status}`}>
                <SpaceCardMenu
                  spaceName={space.name}
                  favorite={favoriteIds.has(space.id)}
                  revealAvailable={!!desktopBridge && !!space.rootPath}
                  onOpen={() => openSpace(space)}
                  onReveal={() => void revealSpace(space)}
                  onCopyPath={() => void copySpacePath(space)}
                  onRename={() => {
                    setSpaceActionError("");
                    setRenameTarget(space);
                  }}
                  onToggleFavorite={() => toggleFavorite(space.id)}
                  onRemove={() => void requestRemove(space)}
                />
                <button type="button" onClick={() => openSpace(space)} aria-label={`${space.name}: ${t(statusKey(space.status))}`}>
                  <span className="spaces-module__card-top">
                    <span className="spaces-module__folder"><Folder size={24} /></span>
                    <span className={`spaces-module__status spaces-module__status--${space.status}`}>
                      {favoriteIds.has(space.id) ? <Star size={12} fill="currentColor" aria-label={t("spacesModule.favorited")} /> : null}
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
