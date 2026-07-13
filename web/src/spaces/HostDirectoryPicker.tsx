import { useCallback, useEffect, useState } from "react";
import { ArrowUp, Check, Folder, HardDrive, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchHostDirectories, type HostDirectoryListing } from "./hostDirectoryApi.ts";

export function HostDirectoryPicker({
  selectedPath,
  disabled,
  onSelect,
}: {
  selectedPath: string;
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
      setListing(await fetchHostDirectories(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("spacesModule.folderBrowseFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void browse(selectedPath || undefined); }, [browse]);

  return (
    <div className="host-directory-picker">
      <div className="host-directory-picker__header">
        <span>{t("spacesModule.hostBrowserTitle")}</span>
        <div className="host-directory-picker__roots" aria-label={t("spacesModule.hostLocations")}>
          {listing?.roots.map((root) => (
            <button type="button" key={root} title={root} onClick={() => void browse(root)} disabled={disabled || loading}>
              <HardDrive size={14} /> {root}
            </button>
          ))}
        </div>
      </div>

      <div className="host-directory-picker__path" title={listing?.path}>
        {listing?.path ?? t("spacesModule.loadingFolders")}
      </div>

      <div className="host-directory-picker__list" aria-busy={loading}>
        {loading ? (
          <div className="host-directory-picker__state"><LoaderCircle className="is-spinning" size={18} /> {t("spacesModule.loadingFolders")}</div>
        ) : error ? (
          <div className="host-directory-picker__state host-directory-picker__state--error" role="alert">{error}</div>
        ) : (
          <>
            {listing?.parentPath ? (
              <button type="button" onClick={() => void browse(listing.parentPath!)} disabled={disabled}>
                <ArrowUp size={16} /> <span>{t("spacesModule.parentFolder")}</span>
              </button>
            ) : null}
            {listing?.entries.map((entry) => (
              <button type="button" key={entry.path} onClick={() => void browse(entry.path)} disabled={disabled}>
                <Folder size={16} /> <span>{entry.name}</span>
              </button>
            ))}
            {!listing?.parentPath && listing?.entries.length === 0 ? (
              <div className="host-directory-picker__state">{t("spacesModule.folderEmpty")}</div>
            ) : null}
          </>
        )}
      </div>

      <button
        type="button"
        className="host-directory-picker__select"
        disabled={disabled || loading || !!error || !listing}
        onClick={() => listing && onSelect(listing.path)}
      >
        <Check size={15} /> {t("spacesModule.selectCurrentFolder")}
      </button>
      {selectedPath ? (
        <div className="host-directory-picker__selected" title={selectedPath}>
          {t("spacesModule.selectedFolder")}: {selectedPath}
        </div>
      ) : null}
    </div>
  );
}
