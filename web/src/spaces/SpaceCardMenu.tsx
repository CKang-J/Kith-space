import { useEffect, useRef, useState } from "react";
import { Copy, Ellipsis, ExternalLink, FolderOpen, Pencil, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SpaceCardMenuProps {
  spaceName: string;
  favorite: boolean;
  revealAvailable: boolean;
  onOpen(): void;
  onReveal(): void;
  onCopyPath(): void;
  onRename(): void;
  onToggleFavorite(): void;
  onRemove(): void;
}

export function SpaceCardMenu({
  spaceName,
  favorite,
  revealAvailable,
  onOpen,
  onReveal,
  onCopyPath,
  onRename,
  onToggleFavorite,
  onRemove,
}: SpaceCardMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
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

  const select = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className={`spaces-module__card-menu${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="spaces-module__card-menu-trigger"
        aria-label={t("spacesModule.menuLabel", { name: spaceName })}
        title={t("spacesModule.menuLabel", { name: spaceName })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="spaces-module__card-menu-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => select(onOpen)}>
            <ExternalLink size={15} aria-hidden="true" />
            {t("spacesModule.open")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => select(onReveal)}
            disabled={!revealAvailable}
            title={!revealAvailable ? t("spacesModule.desktopOnly") : undefined}
          >
            <FolderOpen size={15} aria-hidden="true" />
            {t("spacesModule.revealInFileManager")}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onCopyPath)}>
            <Copy size={15} aria-hidden="true" />
            {t("spacesModule.copyPath")}
          </button>
          <div className="spaces-module__card-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => select(onRename)}>
            <Pencil size={15} aria-hidden="true" />
            {t("spacesModule.rename")}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onToggleFavorite)}>
            <Star size={15} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
            {t(favorite ? "spacesModule.unfavorite" : "spacesModule.favorite")}
          </button>
          <div className="spaces-module__card-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => select(onRemove)}>
            <Trash2 size={15} aria-hidden="true" />
            {t("spacesModule.remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
