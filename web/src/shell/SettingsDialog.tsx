import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--foreground)_32%,transparent)] p-5 backdrop-blur-[1.5px] sm:p-7 lg:p-10"
      onMouseDown={close}
    >
      <section
        ref={dialogRef}
        className="relative flex h-[calc(100vh-2.5rem)] w-[calc(100vw-2.5rem)] max-h-[790px] max-w-[960px] overflow-hidden rounded-3xl border border-border/50 bg-secondary p-0 shadow-[0_20px_60px_color-mix(in_oklch,var(--foreground)_12%,transparent)] sm:h-[calc(100vh-3.5rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="settings-dialog-title" className="sr-only">{t("nav.settings")}</h2>
        <Button
          ref={closeButtonRef}
          className="absolute top-3.5 right-4 z-10 rounded-full bg-transparent [&_svg:not([class*='size-'])]:size-[18px]"
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("confirm.cancel")}
          onClick={close}
        >
          <X aria-hidden="true" />
        </Button>
        <div className="flex min-h-0 w-full flex-col sm:flex-row">
          <Settings sectionOverride={section ?? "human"} />
        </div>
      </section>
    </div>
  );
}
