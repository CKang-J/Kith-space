import { LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { cn } from "@/lib/utils";

export interface CanvasChipModel {
  canvasId: string;
  canvasTitle: string;
}

export function CanvasChip({
  canvas,
  className,
}: {
  canvas: CanvasChipModel;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const title = canvas.canvasTitle?.trim() || t("chat.canvasUntitled");
  const label = t("chat.canvasLabel", { title });

  const openCanvas = () => {
    navigate(workspaceLocationForModule(location.pathname, location.search, {
      moduleId: "canvas",
      canvas: canvas.canvasId,
      canvasTitle: canvas.canvasTitle,
    }));
  };

  return (
    <button
      type="button"
      data-canvas-chip
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={openCanvas}
      title={t("chat.canvasOpenInCanvas", { title })}
    >
      <LayoutDashboard size={14} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
