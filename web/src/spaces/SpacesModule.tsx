import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SearchField } from "../components/SearchField.tsx";
import { useConfirm } from "../ConfirmModal.tsx";
import { copyText } from "../clipboard.ts";
import { getDesktopBridge } from "../desktopBridge.ts";
import { useStore, type SpaceInfo } from "../store.tsx";
import { useToast } from "../toast.tsx";
import { SpaceCardContextMenu, SpaceCardMenu } from "./SpaceCardMenu.tsx";
import { SpaceCreateMenu, type SpaceCreateIntent } from "./SpaceCreateMenu.tsx";
import { SpaceFolderDialog } from "./SpaceFolderDialog.tsx";
import type { SpaceFolderIntent } from "./SpaceFolderForm.tsx";
import { SpaceRenameDialog } from "./SpaceRenameDialog.tsx";
import { removeSpacesInOrder } from "./spaceBatchRemoval.ts";
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
  const [bulkSelectionEnabled, setBulkSelectionEnabled] = useState(false);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<string>>(() => new Set());
  const [bulkRemoving, setBulkRemoving] = useState(false);

  const childSpaces = [...spaces.filter((space) => !space.isHome)]
    .sort((a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSpaces = normalizedQuery
    ? childSpaces.filter((space) => `${space.name} ${space.rootPath ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
    : childSpaces;
  const isSearchEmpty = childSpaces.length > 0 && visibleSpaces.length === 0;

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

  const toggleBulkSelection = () => {
    if (bulkSelectionEnabled) setSelectedSpaceIds(new Set());
    setBulkSelectionEnabled((current) => !current);
  };

  const selectAllVisibleSpaces = () => {
    setSelectedSpaceIds(new Set(visibleSpaces.map((space) => space.id)));
  };

  const allVisibleSelected = visibleSpaces.length > 0 && visibleSpaces.every((space) => selectedSpaceIds.has(space.id));

  const toggleSelectedSpace = (spaceId: string) => {
    setSelectedSpaceIds((current) => {
      const next = new Set(current);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  };

  const requestBulkRemove = async () => {
    if (bulkRemoving || selectedSpaceIds.size === 0) return;
    const selectedIds = childSpaces.filter((space) => selectedSpaceIds.has(space.id)).map((space) => space.id);
    if (selectedIds.length === 0) return;
    const accepted = await confirm({
      title: t("spacesModule.bulkRemoveConfirmTitle", { count: selectedIds.length }),
      message: t("spacesModule.bulkRemoveConfirmDescription"),
      confirmLabel: t("spacesModule.bulkRemoveAction"),
      danger: true,
    });
    if (!accepted) return;
    setBulkRemoving(true);
    setCatalogError("");
    try {
      const { removedIds, failedIds } = await removeSpacesInOrder(selectedIds, removeSpace);
      if (removedIds.length > 0) {
        setFavoriteIds((current) => {
          const next = new Set(current);
          for (const spaceId of removedIds) next.delete(spaceId);
          persistFavoriteSpaces(next);
          return next;
        });
      }
      setSelectedSpaceIds(new Set(failedIds));
      if (failedIds.length > 0) {
        setCatalogError(t("spacesModule.bulkRemoveFailed", { count: failedIds.length }));
      } else {
        setBulkSelectionEnabled(false);
        toast.info(t("spacesModule.bulkRemoveSuccess", { count: removedIds.length }));
      }
    } finally {
      setBulkRemoving(false);
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
      const isRelocate = flow === "relocate";
      if (isRelocate) {
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
      const createdSpace = result.space;
      resetFlow();
      if (isRelocate) {
        navigate(`/s/${createdSpace.slug}/channel`);
        return;
      }
      const openNow = await confirm({
        title: t("spacesModule.createSuccessOpenTitle"),
        message: t("spacesModule.createSuccessOpenMessage", { name: createdSpace.name }),
        confirmLabel: t("spacesModule.createSuccessOpenConfirm"),
        cancelLabel: t("spacesModule.createSuccessStay"),
      });
      if (openNow) navigate(`/s/${createdSpace.slug}/channel`);
      else toast.info(t("spacesModule.createSuccess", { name: createdSpace.name }));
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
    <div className={bulkSelectionEnabled ? "spaces-module spaces-module--bulk" : "spaces-module"}>
      <header className="spaces-module__header">
        <div className="spaces-module__header-start">
          <h1>{t("spacesModule.title")}</h1>
          <span className="spaces-module__count">
            {bulkSelectionEnabled
              ? t("spacesModule.bulkSelected", { count: selectedSpaceIds.size })
              : t("spacesModule.spaceCount", { count: childSpaces.length })}
          </span>
        </div>
        <div className="spaces-module__header-end">
          {!bulkSelectionEnabled ? (
            <SearchField
              className="spaces-module__search"
              value={query}
              onValueChange={setQuery}
              clearLabel={t("spacesModule.clearSearch")}
              aria-label={t("spacesModule.searchPlaceholder")}
              placeholder={t("spacesModule.searchPlaceholder")}
            />
          ) : null}
          <div className={bulkSelectionEnabled ? "spaces-module__actions spaces-module__bulk-bar" : "spaces-module__actions"}>
            {bulkSelectionEnabled ? (
              <>
                {!allVisibleSelected && visibleSpaces.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={bulkRemoving}
                    onClick={selectAllVisibleSpaces}
                  >
                    {t("spacesModule.bulkSelectAll")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={bulkRemoving}
                  onClick={toggleBulkSelection}
                >
                  {t("spacesModule.cancelBulkManage")}
                </Button>
                <span className="spaces-module__bulk-divider" aria-hidden="true" />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={bulkRemoving || selectedSpaceIds.size === 0}
                  onClick={() => void requestBulkRemove()}
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  {t("spacesModule.bulkRemoveAction")}
                </Button>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="spaces-module__action spaces-module__action--icon spaces-module__action--bulk"
                      onClick={toggleBulkSelection}
                      disabled={bulkRemoving || childSpaces.length === 0}
                      aria-label={t("spacesModule.bulkManage")}
                    >
                      <CheckSquare size={17} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("spacesModule.bulkManage")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="spaces-module__action spaces-module__action--icon"
                      onClick={refresh}
                      disabled={refreshing}
                      aria-label={t("spacesModule.refresh")}
                    >
                      <RefreshCw size={17} className={refreshing ? "is-spinning" : undefined} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("spacesModule.refresh")}</TooltipContent>
                </Tooltip>
                <SpaceCreateMenu onSelect={openCreate} />
              </>
            )}
          </div>
        </div>
      </header>

      {catalogError ? <div className="spaces-module__error" role="alert">{catalogError}</div> : null}

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

      <div className="spaces-module__body">
        {visibleSpaces.length > 0 ? (
          <div className={bulkSelectionEnabled ? "spaces-module__grid spaces-module__grid--selecting" : "spaces-module__grid"}>
            {visibleSpaces.map((space) => {
              const ready = space.status === "ready";
              const lastOpened = formatLastOpened(space.lastOpenedAt);
              const menuProps = {
                favorite: favoriteIds.has(space.id),
                revealAvailable: !!desktopBridge && !!space.rootPath,
                onOpen: () => openSpace(space),
                onReveal: () => void revealSpace(space),
                onCopyPath: () => void copySpacePath(space),
                onRename: () => {
                  setSpaceActionError("");
                  setRenameTarget(space);
                },
                onToggleFavorite: () => toggleFavorite(space.id),
                onRemove: () => void requestRemove(space),
              };
              return (
                <SpaceCardContextMenu
                  key={space.id}
                  disabled={bulkSelectionEnabled}
                  {...menuProps}
                >
                  <article
                    className={`spaces-module__card spaces-module__card--${space.status}${selectedSpaceIds.has(space.id) ? " is-selected" : ""}`}
                  >
                    {bulkSelectionEnabled ? (
                      <label className="spaces-module__card-select">
                        <input
                          type="checkbox"
                          checked={selectedSpaceIds.has(space.id)}
                          onChange={() => toggleSelectedSpace(space.id)}
                        onClick={(event) => event.stopPropagation()}
                          disabled={bulkRemoving}
                          aria-label={t("spacesModule.selectSpace", { name: space.name })}
                        />
                        <span className="spaces-module__card-select-box" aria-hidden="true">
                          {selectedSpaceIds.has(space.id) ? <Check size={13} strokeWidth={2.5} /> : null}
                        </span>
                      </label>
                    ) : (
                      <SpaceCardMenu
                        spaceName={space.name}
                        {...menuProps}
                      />
                    )}
                    <button
                      type="button"
                      className="spaces-module__card-body"
                      onClick={() => {
                        if (bulkSelectionEnabled) toggleSelectedSpace(space.id);
                        else openSpace(space);
                      }}
                      aria-label={`${space.name}: ${t(statusKey(space.status))}`}
                      disabled={bulkSelectionEnabled ? bulkRemoving : false}
                    >
                      <span className="spaces-module__card-head">
                        <span className="spaces-module__folder" aria-hidden="true">
                          <Folder size={20} strokeWidth={1.75} />
                          {favoriteIds.has(space.id) ? (
                            <Star className="spaces-module__folder-star" size={11} fill="currentColor" aria-label={t("spacesModule.favorited")} />
                          ) : null}
                        </span>
                        <span className="spaces-module__card-head-text">
                          <span className="spaces-module__name">{space.name}</span>
                          {!ready ? (
                            <span className={`spaces-module__status spaces-module__status--${space.status}`}>
                              <AlertTriangle size={12} aria-hidden="true" />
                              {t(statusKey(space.status))}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="spaces-module__path" title={space.rootPath}>
                        <span className="spaces-module__path-value">{space.rootPath || "-"}</span>
                      </span>
                      <span className="spaces-module__card-footer">
                        <span className="spaces-module__last-opened">
                          {lastOpened ? t("spacesModule.lastOpened", { time: lastOpened }) : t("spacesModule.neverOpened")}
                        </span>
                        {ready ? (
                          <span className="spaces-module__open-affordance" aria-hidden="true">
                            <ArrowRight size={14} strokeWidth={2} />
                          </span>
                        ) : (
                          <span className="spaces-module__card-action">
                            {t("spacesModule.reconnect")}
                            <Link2 size={14} />
                          </span>
                        )}
                      </span>
                      {!ready && space.rootError ? <span className="spaces-module__root-error">{space.rootError}</span> : null}
                    </button>
                  </article>
                </SpaceCardContextMenu>
              );
            })}
          </div>
        ) : (
          <div className="spaces-module__empty">
            <div className="spaces-module__empty-icon">
              <FolderOpen size={26} aria-hidden="true" />
            </div>
            <h2>
              {isSearchEmpty
                ? t("spacesModule.emptyTitleSearch", { query: query.trim() })
                : t("spacesModule.emptyTitleNone")}
            </h2>
            <p>
              {isSearchEmpty
                ? t("spacesModule.emptyDescriptionSearch")
                : t("spacesModule.emptyDescriptionNone")}
            </p>
            {!isSearchEmpty ? <p className="spaces-module__empty-hint">{t("spacesModule.emptyHomeHint")}</p> : null}
            <div className="spaces-module__empty-actions">
              {isSearchEmpty ? (
                <Button type="button" variant="outline" onClick={() => setQuery("")}>
                  {t("spacesModule.clearSearch")}
                </Button>
              ) : null}
              <Button type="button" onClick={() => openCreate("default")}>
                <FolderPlus data-icon="inline-start" aria-hidden="true" />
                {t("spacesModule.createBlank")}
              </Button>
              <Button type="button" variant="outline" onClick={() => openCreate("attach")}>
                {t("spacesModule.attachExisting")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
