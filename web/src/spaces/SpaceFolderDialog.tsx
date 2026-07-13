import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SpaceFolderForm, type SpaceFolderIntent } from "./SpaceFolderForm.tsx";

export function SpaceFolderDialog({
  intent,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  intent: SpaceFolderIntent;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (input: { name?: string; rootPath?: string }) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
  }, [intent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div
      className="spaces-module__dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
    >
      <section
        ref={dialogRef}
        className="spaces-module__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(`space.${intent}Title`)}
        tabIndex={-1}
      >
        <SpaceFolderForm intent={intent} busy={busy} error={error} onCancel={onCancel} onSubmit={onSubmit} />
      </section>
    </div>
  );
}
