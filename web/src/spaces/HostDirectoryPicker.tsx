import { useCallback, useEffect, useState } from "react";
import { ArrowUp, Folder, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { fetchHostDirectories, type HostDirectoryListing } from "./hostDirectoryApi.ts";

const rowButtonClass = cn(
  "flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-sm shadow-none outline-none",
  "transition-colors hover:bg-muted/45 focus-visible:bg-muted/45",
  "disabled:pointer-events-none disabled:opacity-50",
);

export function HostDirectoryPicker({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<HostDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchHostDirectories(path);
      setListing(next);
      onSelect(next.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("spacesModule.folderBrowseFailed"));
    } finally {
      setLoading(false);
    }
  }, [onSelect, t]);

  useEffect(() => {
    void browse(undefined);
  }, [browse]);

  const currentPath = listing?.path ?? "";

  return (
    <div className="spaces-folder-picker overflow-hidden rounded-lg border border-input">
      <div className="flex items-center gap-2 border-b border-border/35 px-3 py-1.5">
        <span className="shrink-0 text-[11px] text-muted-foreground">{t("spacesModule.folderLocationLabel")}</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
          title={currentPath || undefined}
        >
          {loading && !currentPath ? t("spacesModule.loadingFolders") : currentPath}
        </span>
      </div>

      {listing && listing.roots.length > 1 ? (
        <div className="flex flex-wrap gap-x-2 gap-y-1 border-b border-border/35 px-3 py-1">
          {listing.roots.map((root) => (
            <button
              key={root}
              type="button"
              className="border-0 bg-transparent p-0 font-mono text-[11px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:text-foreground"
              title={root}
              disabled={disabled || loading}
              onClick={() => void browse(root)}
            >
              {root}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="max-h-[min(196px,32vh)] min-h-[112px] overflow-y-auto"
        aria-busy={loading}
      >
        {loading ? (
          <div className="flex h-[112px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            {t("spacesModule.loadingFolders")}
          </div>
        ) : error ? (
          <div className="flex h-[112px] items-center justify-center px-4 text-center text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : (
          <>
            {listing?.parentPath ? (
              <button
                type="button"
                className={cn(rowButtonClass, "text-muted-foreground hover:text-foreground")}
                disabled={disabled}
                onClick={() => void browse(listing.parentPath!)}
              >
                <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("spacesModule.parentFolder")}</span>
              </button>
            ) : null}
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={cn(rowButtonClass, "text-foreground")}
                disabled={disabled}
                onClick={() => void browse(entry.path)}
              >
                <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
            {!listing?.parentPath && listing?.entries.length === 0 ? (
              <div className="flex h-[112px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {t("spacesModule.folderEmpty")}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
