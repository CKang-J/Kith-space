import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Ellipsis, ExternalLink, FolderOpen, Pencil, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SpaceCardContextMenuRequest {
  spaceId: string;
  clientX: number;
  clientY: number;
}

interface SpaceCardMenuProps {
  spaceName: string;
  favorite: boolean;
  revealAvailable: boolean;
  contextMenuRequest: SpaceCardContextMenuRequest | null;
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
  contextMenuRequest,
  onOpen,
  onReveal,
  onCopyPath,
  onRename,
  onToggleFavorite,
  onRemove,
}: SpaceCardMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [contextPosition, setContextPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenuRequest) {
      setOpen(false);
      setContextPosition(null);
      return;
    }
    setContextPosition({ left: contextMenuRequest.clientX, top: contextMenuRequest.clientY });
    setOpen(true);
  }, [contextMenuRequest]);

  useLayoutEffect(() => {
    if (!open || !contextPosition || !popoverRef.current) return;
    const bounds = popoverRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(contextPosition.left, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(contextPosition.top, window.innerHeight - bounds.height - 8));
    if (left !== contextPosition.left || top !== contextPosition.top) setContextPosition({ left, top });
  }, [contextPosition, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
        setContextPosition(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setContextPosition(null);
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
    setContextPosition(null);
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
        onClick={() => {
          setContextPosition(null);
          setOpen((value) => !value);
        }}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className={`spaces-module__card-menu-popover${contextPosition ? " is-context" : ""}`}
          role="menu"
          style={contextPosition ?? undefined}
        >
          <button type="button" role="menuitem" onClick={() => select(onOpen)}>
            <ExternalLink size={16} aria-hidden="true" />
            {t("spacesModule.open")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => select(onReveal)}
            disabled={!revealAvailable}
            title={!revealAvailable ? t("spacesModule.desktopOnly") : undefined}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {t("spacesModule.revealInFileManager")}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onCopyPath)}>
            <Copy size={16} aria-hidden="true" />
            {t("spacesModule.copyPath")}
          </button>
          <div className="spaces-module__card-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => select(onRename)}>
            <Pencil size={16} aria-hidden="true" />
            {t("spacesModule.rename")}
          </button>
          <button type="button" role="menuitem" onClick={() => select(onToggleFavorite)}>
            <Star size={16} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
            {t(favorite ? "spacesModule.unfavorite" : "spacesModule.favorite")}
          </button>
          <div className="spaces-module__card-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => select(onRemove)}>
            <Trash2 size={16} aria-hidden="true" />
            {t("spacesModule.remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
