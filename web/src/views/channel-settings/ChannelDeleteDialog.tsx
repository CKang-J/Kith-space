import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEscClose } from "../../ConfirmModal.tsx";
import { matchesDeleteConfirmation } from "./channelSettingsData.ts";

interface ChannelDeleteDialogProps {
  channelName: string;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(): void;
}

export function ChannelDeleteDialog({
  channelName,
  busy,
  error,
  onCancel,
  onConfirm,
}: ChannelDeleteDialogProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const close = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);
  useEscClose(close);
  const matches = matchesDeleteConfirmation(confirmation, channelName);

  return createPortal(
    <div className="modal-bg channel-settings-delete-backdrop" onClick={close}>
      <div
        className="channel-settings-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-settings-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="channel-settings-delete-title">{t("channelSettings.deleteConfirmTitle", { name: channelName })}</h3>
        <p>{t("channelSettings.deleteConfirmDescription")}</p>
        <label htmlFor="channel-settings-delete-confirmation">
          {t("channelSettings.deleteConfirmPrompt", { name: channelName })}
        </label>
        <input
          id="channel-settings-delete-confirmation"
          autoFocus
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={busy}
        />
        {error ? <div className="channel-settings__error" role="alert">{error}</div> : null}
        <div className="channel-settings-delete-dialog__actions">
          <button type="button" className="channel-settings__button" onClick={close} disabled={busy}>
            {t("channelSettings.cancel")}
          </button>
          <button
            type="button"
            className="channel-settings__button channel-settings__button--danger"
            onClick={onConfirm}
            disabled={!matches || busy}
          >
            {busy ? t("channelSettings.deleting") : t("channelSettings.deleteChannel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
