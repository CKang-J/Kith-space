import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEscClose } from "../ConfirmModal.tsx";

interface SpaceRenameDialogProps {
  currentName: string;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(name: string): void;
}

export function SpaceRenameDialog({ currentName, busy, error, onCancel, onConfirm }: SpaceRenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const normalized = name.trim();
  const close = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);
  useEscClose(close);

  return createPortal(
    <div className="modal-bg spaces-module__rename-backdrop" onClick={close}>
      <div
        className="spaces-module__rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spaces-rename-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="spaces-rename-title">{t("spacesModule.renameTitle")}</h3>
        <label htmlFor="spaces-rename-name">{t("spacesModule.nameLabel")}</label>
        <input
          id="spaces-rename-name"
          autoFocus
          value={name}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && normalized && normalized !== currentName && !busy) onConfirm(normalized);
          }}
        />
        {error ? <div className="spaces-module__error" role="alert">{error}</div> : null}
        <div className="spaces-module__rename-actions">
          <button type="button" className="spaces-module__rename-cancel" onClick={close} disabled={busy}>
            {t("spacesModule.cancel")}
          </button>
          <button
            type="button"
            className="spaces-module__rename-confirm"
            onClick={() => onConfirm(normalized)}
            disabled={!normalized || normalized === currentName || busy}
          >
            {busy ? t("spacesModule.renaming") : t("spacesModule.rename")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
