import { PanelVisibilityIcon } from "../components/icons/PanelVisibilityIcon.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.tsx";
import { cn } from "../lib/utils.ts";

interface WorkspacePanelToggleProps {
  open: boolean;
  onToggle(): void;
  className?: string;
}

export function WorkspacePanelToggle({ open, onToggle, className }: WorkspacePanelToggleProps) {
  const label = open ? "收起右侧模块面板" : "展开右侧模块面板";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("shell-workspace-panel-trigger", className)}
          aria-label={label}
          aria-pressed={open}
          onClick={onToggle}
        >
          <PanelVisibilityIcon open={open} className="workspace-panel-toggle__icon -scale-x-100" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
