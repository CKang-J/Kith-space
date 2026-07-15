import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListChecks, Paperclip, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ComposerActionsProps {
  allowTask: boolean;
  taskActive: boolean;
  uploadDisabled: boolean;
  taskDisabled: boolean;
  onAddFiles(): void;
  onTaskChange(active: boolean): void;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  ready: boolean;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;

export function ComposerActions({
  allowTask,
  taskActive,
  uploadDisabled,
  taskDisabled,
  onAddFiles,
  onTaskChange,
}: ComposerActionsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, width: 0, ready: false });
  const triggerDisabled = uploadDisabled && (!allowTask || taskDisabled);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.closest<HTMLElement>(".composer-box") ?? trigger;
      const anchorRect = anchor.getBoundingClientRect();
      const width = Math.min(anchorRect.width, window.innerWidth - VIEWPORT_MARGIN * 2);
      menu.style.width = `${width}px`;
      const menuRect = menu.getBoundingClientRect();
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorRect.left, maxLeft));
      const fitsAbove = anchorRect.top >= menuRect.height + MENU_GAP + VIEWPORT_MARGIN;
      const top = fitsAbove
        ? anchorRect.top - menuRect.height - MENU_GAP
        : Math.min(anchorRect.bottom + MENU_GAP, window.innerHeight - menuRect.height - VIEWPORT_MARGIN);
      setMenuPosition({ left, top: Math.max(VIEWPORT_MARGIN, top), width, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (triggerDisabled) {
      setOpen(false);
      setMenuPosition((position) => ({ ...position, ready: false }));
    }
  }, [triggerDisabled]);

  const focusMenuItem = (last = false) => {
    requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      items?.[last ? items.length - 1 : 0]?.focus();
    });
  };

  const select = (action: () => void) => {
    setOpen(false);
    setMenuPosition((position) => ({ ...position, ready: false }));
    action();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items.at(-1)?.focus();
    else if (event.key === "ArrowDown") items[current < 0 ? 0 : (current + 1) % items.length]?.focus();
    else items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="composer-actions">
      <div className="composer-add-menu">
        <button
          ref={triggerRef}
          type="button"
          className="cb-icon composer-add-trigger"
          aria-label={t("chat.addMenu")}
          title={t("chat.addMenu")}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={triggerDisabled}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            setOpen(true);
            focusMenuItem(event.key === "ArrowUp");
          }}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      {allowTask && taskActive ? (
        <button
          type="button"
          className="composer-task-chip"
          aria-pressed="true"
          aria-label={t("chat.removeAssignedTask")}
          title={t("chat.removeAssignedTask")}
          disabled={taskDisabled}
          onClick={() => onTaskChange(false)}
        >
          <span className="composer-task-chip__icon" aria-hidden="true">
            <ListChecks className="composer-task-chip__default-icon" size={15} />
            <X className="composer-task-chip__remove-icon" size={11} />
          </span>
          <span>{t("chat.assignTask")}</span>
        </button>
      ) : null}
      {open ? createPortal(
        <div
          ref={menuRef}
          className="composer-add-menu__popover"
          role="menu"
          aria-label={t("chat.addMenu")}
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width || undefined, visibility: menuPosition.ready ? "visible" : "hidden" }}
          onKeyDown={onMenuKeyDown}
        >
          <button type="button" role="menuitem" disabled={uploadDisabled} onClick={() => select(onAddFiles)}>
            <Paperclip size={17} aria-hidden="true" />
            <span>{t("chat.addPhotosAndFiles")}</span>
          </button>
          {allowTask ? (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={taskActive}
              className={taskActive ? "is-selected" : ""}
              disabled={taskDisabled}
              onClick={() => select(() => onTaskChange(!taskActive))}
            >
              <ListChecks size={17} aria-hidden="true" />
              <span>{t("chat.assignTask")}</span>
              {taskActive ? <Check className="composer-add-menu__check" size={16} aria-hidden="true" /> : null}
            </button>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
