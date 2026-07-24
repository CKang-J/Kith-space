import { Fragment, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Copy, Ellipsis, ExternalLink, FolderOpen, Pencil, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SpaceCardMenuActions {
  favorite: boolean;
  revealAvailable: boolean;
  onOpen(): void;
  onReveal(): void;
  onCopyPath(): void;
  onRename(): void;
  onToggleFavorite(): void;
  onRemove(): void;
}

interface SpaceCardMenuProps extends SpaceCardMenuActions {
  spaceName: string;
}

interface SpaceCardContextMenuProps extends SpaceCardMenuActions {
  children: ReactElement;
  disabled?: boolean;
}

interface SpaceMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  disabled?: boolean;
  title?: string;
  destructive?: boolean;
  filled?: boolean;
}

function useSpaceMenuGroups({
  favorite,
  revealAvailable,
  onOpen,
  onReveal,
  onCopyPath,
  onRename,
  onToggleFavorite,
  onRemove,
}: SpaceCardMenuActions): SpaceMenuItem[][] {
  const { t } = useTranslation();

  return [
    [
      { key: "open", label: t("spacesModule.open"), icon: ExternalLink, onSelect: onOpen },
      {
        key: "reveal",
        label: t("spacesModule.revealInFileManager"),
        icon: FolderOpen,
        onSelect: onReveal,
        disabled: !revealAvailable,
        title: !revealAvailable ? t("spacesModule.desktopOnly") : undefined,
      },
      { key: "copy", label: t("spacesModule.copyPath"), icon: Copy, onSelect: onCopyPath },
    ],
    [
      { key: "rename", label: t("spacesModule.rename"), icon: Pencil, onSelect: onRename },
      {
        key: "favorite",
        label: t(favorite ? "spacesModule.unfavorite" : "spacesModule.favorite"),
        icon: Star,
        onSelect: onToggleFavorite,
        filled: favorite,
      },
    ],
    [
      {
        key: "remove",
        label: t("spacesModule.remove"),
        icon: Trash2,
        onSelect: onRemove,
        destructive: true,
      },
    ],
  ];
}

const menuContentClassName =
  "w-[190px] min-w-[190px] rounded-xl border border-[var(--hair-strong)] bg-[var(--surface)] p-1 text-[14px] shadow-[0_8px_24px_var(--shadow-2)] ring-0";
const menuItemClassName =
  "min-h-[34px] gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px] leading-5 focus:bg-[var(--canvas-soft)]";

function DropdownSpaceMenuItems({ groups }: { groups: SpaceMenuItem[][] }) {
  return groups.map((group, groupIndex) => (
    <Fragment key={group[0]?.key ?? groupIndex}>
      {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuGroup>
        {group.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.key}
              variant={item.destructive ? "destructive" : "default"}
              className={cn(menuItemClassName, item.disabled && "data-disabled:pointer-events-auto")}
              disabled={item.disabled}
              title={item.title}
              onSelect={item.onSelect}
            >
              <Icon data-icon="inline-start" fill={item.filled ? "currentColor" : "none"} aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuGroup>
    </Fragment>
  ));
}

function ContextSpaceMenuItems({ groups }: { groups: SpaceMenuItem[][] }) {
  return groups.map((group, groupIndex) => (
    <Fragment key={group[0]?.key ?? groupIndex}>
      {groupIndex > 0 ? <ContextMenuSeparator /> : null}
      <ContextMenuGroup>
        {group.map((item) => {
          const Icon = item.icon;
          return (
            <ContextMenuItem
              key={item.key}
              variant={item.destructive ? "destructive" : "default"}
              className={cn(menuItemClassName, item.disabled && "data-disabled:pointer-events-auto")}
              disabled={item.disabled}
              title={item.title}
              onSelect={item.onSelect}
            >
              <Icon data-icon="inline-start" fill={item.filled ? "currentColor" : "none"} aria-hidden="true" />
              {item.label}
            </ContextMenuItem>
          );
        })}
      </ContextMenuGroup>
    </Fragment>
  ));
}

export function SpaceCardMenu({ spaceName, ...actions }: SpaceCardMenuProps) {
  const { t } = useTranslation();
  const groups = useSpaceMenuGroups(actions);

  return (
    <div
      className="spaces-module__card-menu absolute top-[13px] right-3 z-[3]"
      onContextMenu={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-[30px] rounded-lg text-[var(--muted)] hover:bg-[var(--canvas-soft)] hover:text-[var(--ink)] data-[state=open]:bg-[var(--canvas-soft)] data-[state=open]:text-[var(--ink)]"
            aria-label={t("spacesModule.menuLabel", { name: spaceName })}
            title={t("spacesModule.menuLabel", { name: spaceName })}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={5} className={menuContentClassName}>
          <DropdownSpaceMenuItems groups={groups} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SpaceCardContextMenu({
  children,
  disabled = false,
  ...actions
}: SpaceCardContextMenuProps) {
  const groups = useSpaceMenuGroups(actions);

  if (disabled) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={menuContentClassName}>
        <ContextSpaceMenuItems groups={groups} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
