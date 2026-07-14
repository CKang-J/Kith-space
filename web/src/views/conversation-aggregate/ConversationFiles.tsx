import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Download, ExternalLink, FileText, Search, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchField } from "../../components/SearchField.tsx";
import { fmtDateTime } from "../../format.ts";
import { useStore } from "../../store.tsx";
import {
  classifyConversationFile,
  filterConversationFiles,
  formatConversationFileSize,
} from "./conversationAggregateData.ts";
import type { ConversationFile, ConversationFileCategory } from "./types.ts";

interface ConversationFilesProps {
  conversationId: string;
  onJumpToMessage(messageId: string): void;
}

interface FileLoadState {
  conversationId: string;
  status: "loading" | "ready" | "error";
  files: ConversationFile[];
}

interface FileFilterState {
  conversationId: string;
  category: ConversationFileCategory;
  query: string;
  searchOpen: boolean;
}

const initialFilters = (conversationId: string): FileFilterState => ({
  conversationId,
  category: "all",
  query: "",
  searchOpen: false,
});

export function ConversationFiles({ conversationId, onJumpToMessage }: ConversationFilesProps) {
  const { t } = useTranslation();
  const { api, attachmentUrl } = useStore();
  const [loadState, setLoadState] = useState<FileLoadState>({ conversationId, status: "loading", files: [] });
  const [filtersState, setFiltersState] = useState<FileFilterState>(() => initialFilters(conversationId));
  const [retryVersion, setRetryVersion] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchRegionId = `conversation-file-search-${useId().replace(/:/g, "")}`;
  const load = loadState.conversationId === conversationId
    ? loadState
    : { conversationId, status: "loading" as const, files: [] };
  const filters = filtersState.conversationId === conversationId
    ? filtersState
    : initialFilters(conversationId);

  const updateFilters = (update: Partial<Omit<FileFilterState, "conversationId">>) => {
    setFiltersState((current) => ({
      ...(current.conversationId === conversationId ? current : initialFilters(conversationId)),
      ...update,
      conversationId,
    }));
  };

  useEffect(() => {
    let active = true;
    setLoadState({ conversationId, status: "loading", files: [] });
    void (async () => {
      try {
        const response = await api("GET", `/api/channels/${encodeURIComponent(conversationId)}/files`);
        if (!active) return;
        if (!Array.isArray(response?.files)) throw new Error(response?.error || "Invalid file response");
        setLoadState({ conversationId, status: "ready", files: response.files as ConversationFile[] });
      } catch {
        if (active) setLoadState({ conversationId, status: "error", files: [] });
      }
    })();
    return () => { active = false; };
    // Store.api is intentionally omitted: it is recreated with provider renders, while conversationId is the request scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, retryVersion]);

  useEffect(() => {
    if (filters.searchOpen) searchInputRef.current?.focus();
  }, [filters.searchOpen, conversationId]);

  const closeSearch = () => {
    updateFilters({ searchOpen: false });
    searchButtonRef.current?.focus();
  };
  const toggleSearch = () => {
    if (!filters.searchOpen) {
      updateFilters({ searchOpen: true });
      return;
    }
    if (!filters.query.trim()) closeSearch();
    else searchInputRef.current?.focus();
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (filters.query) updateFilters({ query: "" });
    else closeSearch();
  };

  const visibleFiles = filterConversationFiles(load.files, filters.category, filters.query);
  const hasFilters = filters.category !== "all" || !!filters.query.trim();
  const categories: readonly { value: ConversationFileCategory; label: string }[] = [
    { value: "all", label: t("conversationAggregate.files.filters.all") },
    { value: "image", label: t("conversationAggregate.files.filters.images") },
    { value: "video", label: t("conversationAggregate.files.filters.videos") },
    { value: "file", label: t("conversationAggregate.files.filters.files") },
  ];

  return (
    <section className="conversation-files" aria-label={t("conversationAggregate.files.title")}>
      <div className="conversation-files__tools">
        <div className="conversation-files__filter-row">
          <div className="conversation-files__filters" role="radiogroup" aria-label={t("conversationAggregate.files.filterLabel")}>
            {categories.map((category) => (
              <button
                key={category.value}
                type="button"
                className="conversation-files__filter"
                role="radio"
                aria-checked={filters.category === category.value}
                onClick={() => updateFilters({ category: category.value })}
              >
                {category.label}
              </button>
            ))}
          </div>
          <button
            ref={searchButtonRef}
            type="button"
            className="conversation-files__search-toggle"
            data-open={filters.searchOpen || undefined}
            aria-label={filters.searchOpen ? t("conversationAggregate.files.focusSearch") : t("conversationAggregate.files.openSearch")}
            aria-expanded={filters.searchOpen}
            aria-controls={searchRegionId}
            title={t("conversationAggregate.files.search")}
            onClick={toggleSearch}
          >
            <Search size={18} aria-hidden="true" />
          </button>
        </div>
        <div
          id={searchRegionId}
          className="conversation-files__search-region"
          data-open={filters.searchOpen || undefined}
          aria-hidden={!filters.searchOpen}
        >
          <SearchField
            ref={searchInputRef}
            className="conversation-files__search-field"
            value={filters.query}
            onValueChange={(query) => updateFilters({ query })}
            tabIndex={filters.searchOpen ? 0 : -1}
            placeholder={t("conversationAggregate.files.searchPlaceholder")}
            aria-label={t("conversationAggregate.files.search")}
            clearLabel={t("conversationAggregate.files.clearSearch")}
            onClear={() => searchInputRef.current?.focus()}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
      </div>

      <div className="conversation-aggregate__scroll">
        {load.status === "loading" ? <div className="conversation-aggregate__status">{t("conversationAggregate.loading")}</div> : null}
        {load.status === "error" ? (
          <div className="conversation-aggregate__status">
            <p>{t("conversationAggregate.files.loadFailed")}</p>
            <button type="button" onClick={() => setRetryVersion((version) => version + 1)}>{t("conversationAggregate.retry")}</button>
          </div>
        ) : null}
        {load.status === "ready" && load.files.length === 0 ? (
          <div className="conversation-aggregate__status">{t("conversationAggregate.files.empty")}</div>
        ) : null}
        {load.status === "ready" && load.files.length > 0 && visibleFiles.length === 0 ? (
          <div className="conversation-aggregate__status">
            <p>{t("conversationAggregate.files.noMatches")}</p>
            {hasFilters ? (
              <button type="button" onClick={() => updateFilters({ category: "all", query: "" })}>{t("conversationAggregate.files.clearFilters")}</button>
            ) : null}
          </div>
        ) : null}
        {load.status === "ready" && visibleFiles.length > 0 ? (
          <div className="conversation-files__list">
            {visibleFiles.map((file) => {
              const category = classifyConversationFile(file.mimeType);
              const uploader = file.uploader?.displayName || file.uploader?.name || (file.uploader?.type === "agent" ? t("conversationAggregate.agent") : t("chat.humanKind"));
              const meta = [formatConversationFileSize(file.sizeBytes), uploader, fmtDateTime(file.createdAt ?? undefined)].filter(Boolean).join(" · ");
              return (
                <article key={file.id} className="conversation-file">
                  <a className="conversation-file__main" href={attachmentUrl(file.id)} target="_blank" rel="noreferrer">
                    <span className="conversation-file__preview" data-kind={category}>
                      {category === "image"
                        ? <img src={attachmentUrl(file.id)} alt="" loading="lazy" />
                        : category === "video"
                          ? <Video size={22} aria-hidden="true" />
                          : <FileText size={22} aria-hidden="true" />}
                    </span>
                    <span className="conversation-file__copy">
                      <strong>{file.filename}</strong>
                      {meta ? <span>{meta}</span> : null}
                      {file.sourceMessageText ? <span className="conversation-file__source">{file.sourceMessageText}</span> : null}
                    </span>
                  </a>
                  <div className="conversation-file__actions">
                    {file.messageId ? (
                      <button
                        type="button"
                        aria-label={t("chat.jumpToMessage")}
                        title={t("chat.jumpToMessage")}
                        onClick={() => onJumpToMessage(file.messageId!)}
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                    <a href={attachmentUrl(file.id)} download={file.filename} aria-label={t("chat.download")} title={t("chat.download")}>
                      <Download size={15} aria-hidden="true" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
