import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "../views/misc.tsx";

interface SettingsDialogProps {
  section: string | null;
  onClose(): void;
}

export function SettingsDialog({ section, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".settings-modal-backdrop")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [close]);

  return (
    <div className="modal-bg shell-settings-dialog-bg" onMouseDown={close}>
      <section
        ref={dialogRef}
        className="modal shell-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.settings")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          className="shell-settings-dialog__close"
          type="button"
          aria-label={t("confirm.cancel")}
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <div className="shell-settings-dialog__content">
          <Settings sectionOverride={section ?? "human"} />
        </div>
      </section>
    </div>
  );
}
