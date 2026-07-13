import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SpaceCreateIntent = "default" | "attach";

export function SpaceCreateMenu({ onSelect }: { onSelect: (intent: SpaceCreateIntent) => void }) {
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

  const select = (intent: SpaceCreateIntent) => {
    setOpen(false);
    onSelect(intent);
  };

  return (
    <div className="spaces-module__create" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="spaces-module__action spaces-module__action--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="spaces-create-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <FolderPlus size={17} />
        {t("spacesModule.createSpace")}
        <ChevronDown size={14} className={open ? "is-open" : undefined} />
      </button>
      {open ? (
        <div id="spaces-create-menu" className="spaces-module__create-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => select("default")}>
            <FolderPlus size={16} />
            {t("spacesModule.createBlank")}
          </button>
          <button type="button" role="menuitem" onClick={() => select("attach")}>
            <FolderOpen size={16} />
            {t("spacesModule.attachExisting")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
