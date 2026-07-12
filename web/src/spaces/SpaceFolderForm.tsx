import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "../desktopBridge.ts";

export type SpaceFolderIntent = "default" | "attach" | "relocate";

export function SpaceFolderForm({
  intent,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  intent: SpaceFolderIntent;
  busy: boolean;
  error?: string;
  onCancel?: () => void;
  onSubmit: (input: { name?: string; rootPath?: string }) => void;
}) {
  const { t } = useTranslation();
  const bridge = getDesktopBridge();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const needsPath = intent !== "default";
  const canSubmit = intent === "default" ? !!name.trim() : !!rootPath.trim();

  const pickDirectory = async () => {
    if (!bridge || picking) return;
    setPicking(true);
    setPickerError("");
    try {
      const selected = await bridge.pickSpaceDirectory();
      if (selected) setRootPath(selected);
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="sw-folder-form">
      <div className="sw-form-title">{t(`space.${intent}Title`)}</div>
      {intent !== "relocate" && (
        <input
          autoFocus={intent === "default"}
          value={name}
          placeholder={intent === "attach" ? t("space.attachNamePlaceholder") : t("space.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") onCancel?.(); }}
        />
      )}
      {needsPath && (bridge ? (
        <>
          <button type="button" className="sw-pick" onClick={pickDirectory} disabled={picking || busy}>
            <FolderOpen size={14} /> {picking ? t("space.selectingFolder") : t("space.selectFolder")}
          </button>
          {rootPath && <div className="sw-path" title={rootPath}>{rootPath}</div>}
        </>
      ) : (
        <input
          autoFocus={intent === "relocate"}
          value={rootPath}
          placeholder={t("space.hostPathPlaceholder")}
          onChange={(event) => setRootPath(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") onCancel?.(); }}
        />
      ))}
      {intent === "attach" && <div className="sw-form-hint">{t("space.attachHint")}</div>}
      {intent === "relocate" && <div className="sw-form-hint">{t("space.relocateHint")}</div>}
      {(error || pickerError) && <div className="sw-form-error" role="alert">{error || pickerError}</div>}
      <div className="sw-form-actions">
        {onCancel && <button type="button" className="sw-cancel" onClick={onCancel} disabled={busy}>{t("confirm.cancel")}</button>}
        <button
          type="button"
          className="sw-go"
          disabled={busy || !canSubmit}
          onClick={() => onSubmit({ name: name.trim() || undefined, rootPath: rootPath.trim() || undefined })}
        >
          {busy ? "..." : t(intent === "relocate" ? "space.reconnectBtn" : "space.createBtn")}
        </button>
      </div>
    </div>
  );
}
