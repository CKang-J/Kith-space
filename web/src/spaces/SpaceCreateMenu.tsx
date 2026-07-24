import { ChevronDown, FolderOpen, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SpaceCreateIntent = "default" | "attach";

export function SpaceCreateMenu({ onSelect }: { onSelect: (intent: SpaceCreateIntent) => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 min-[821px]:flex-none">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            className="group/create h-[38px] w-full rounded-[10px] px-[13px] text-[13px] min-[821px]:w-auto"
          >
            <FolderPlus data-icon="inline-start" aria-hidden="true" />
            {t("spacesModule.createSpace")}
            <ChevronDown
              data-icon="inline-end"
              className="transition-transform group-data-[state=open]/create:rotate-180"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={7}
          className="w-[220px] min-w-[220px] rounded-[11px] border border-[var(--hair-strong)] bg-[var(--surface)] p-1.5 shadow-[0_10px_28px_var(--shadow-2)] ring-0"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              className="h-[38px] gap-[9px] rounded-lg px-2.5 py-0 text-[13px] text-[var(--ink-2)] focus:bg-[var(--canvas-soft)] focus:text-[var(--ink)]"
              onSelect={() => onSelect("default")}
            >
              <FolderPlus data-icon="inline-start" aria-hidden="true" />
              {t("spacesModule.createBlank")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-[38px] gap-[9px] rounded-lg px-2.5 py-0 text-[13px] text-[var(--ink-2)] focus:bg-[var(--canvas-soft)] focus:text-[var(--ink)]"
              onSelect={() => onSelect("attach")}
            >
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              {t("spacesModule.attachExisting")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
