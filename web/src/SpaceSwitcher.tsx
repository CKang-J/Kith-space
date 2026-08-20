// Top-left brand button = quick Space switching. Full lifecycle management lives in Home > Spaces.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, FolderKanban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpaceFolderForm } from "./spaces/SpaceFolderForm.tsx";
import { useStore, type SpaceInfo } from "./store.tsx";

type SwitcherFlow = "relocate" | null;

interface SpaceSwitcherProps {
  targetPathForSlug?: (slug: string) => string;
  onMenuOpenChange?(open: boolean): void;
}

export function SpaceSwitcher({
  targetPathForSlug,
  onMenuOpenChange,
}: SpaceSwitcherProps = {}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { spaces, slug, spaceAvatar, relocateSpace, refreshSpaces } = useStore();
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<SwitcherFlow>(null);
  const [relocateTargetId, setRelocateTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cur = spaces.find((space) => space.slug === slug);
  const home = spaces.find((space) => space.isHome);

  const resetFlow = () => {
    setFlow(null);
    setRelocateTargetId(null);
    setError("");
  };
  const close = () => {
    setOpen(false);
    onMenuOpenChange?.(false);
    resetFlow();
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      close();
      return;
    }
    if (open) return;
    setOpen(true);
    onMenuOpenChange?.(true);
    setError("");
    void refreshSpaces().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    });
  };
  const go = (space: SpaceInfo) => {
    if (space.status !== "ready") {
      setRelocateTargetId(space.id);
      setFlow("relocate");
      setError("");
      return;
    }
    close();
    if (space.slug !== slug) nav(targetPathForSlug?.(space.slug) ?? `/s/${space.slug}/channel`);
  };
  const submit = async (input: { name?: string; rootPath?: string }) => {
    if (busy || flow !== "relocate" || !relocateTargetId) return;
    setBusy(true);
    setError("");
    try {
      const result = await relocateSpace(relocateTargetId, input.rootPath || "");
      if (!result.space) {
        setError(result.error || t("space.operationFailed"));
        return;
      }
      close();
      nav(`/s/${result.space.slug}/channel`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setBusy(false);
    }
  };
  const manageSpaces = () => {
    if (!home || home.status !== "ready") return;
    close();
    nav(`/s/${home.slug}/channel?module=spaces`);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button className="brand" aria-label={t("space.switchAriaLabel")}>
          {spaceAvatar ? <img className="brand-img" src={spaceAvatar} alt="" /> : (cur?.name?.[0]?.toUpperCase() || "K")}
          <span className="dot" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        sideOffset={10}
        className="w-80 min-w-80 max-w-[calc(100vw-1rem)] p-1.5"
      >
        <DropdownMenuLabel>{t("space.menuTitle")}</DropdownMenuLabel>
        <DropdownMenuGroup>
          {spaces.map((space) => {
            const unavailable = space.status !== "ready";
            const active = space.slug === slug;
            return (
              <DropdownMenuItem
                key={space.id}
                className={cn(
                  "h-auto min-h-10 gap-2.5 px-2 py-1.5",
                  active && "bg-accent font-medium text-accent-foreground focus:bg-accent",
                  unavailable && "text-muted-foreground",
                )}
                onSelect={(event) => {
                  event.preventDefault();
                  go(space);
                }}
                title={space.rootPath}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-sm text-foreground">
                  {(space.name?.[0] || "?").toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{space.name}</span>
                  {unavailable ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {space.rootError || t(space.status === "missing" ? "space.rootMissing" : "space.rootError")}
                    </span>
                  ) : null}
                </span>
                {unavailable ? <AlertTriangle className="ml-auto text-destructive" aria-hidden="true" /> : null}
                {active && !unavailable ? <Check className="ml-auto" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        {flow === "relocate" ? (
          <SpaceFolderForm intent="relocate" busy={busy} error={error} onCancel={resetFlow} onSubmit={submit} />
        ) : (
          <>
            {error ? <div className="sw-form-error" role="alert">{error}</div> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!home || home.status !== "ready"}
              onSelect={(event) => {
                event.preventDefault();
                manageSpaces();
              }}
            >
              <FolderKanban data-icon="inline-start" aria-hidden="true" />
              {t("space.manageSpaces")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
