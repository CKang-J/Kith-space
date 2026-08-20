import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDesktopBridge } from "../desktopBridge.ts";
import { HostDirectoryPicker } from "./HostDirectoryPicker.tsx";

export type SpaceFolderIntent = "default" | "attach" | "relocate";

const intentHintKey: Record<SpaceFolderIntent, string | null> = {
  default: null,
  attach: "space.attachSubtitle",
  relocate: "space.relocateHint",
};

const intentNameLabelKey: Record<Exclude<SpaceFolderIntent, "relocate">, string> = {
  default: "space.nameLabel",
  attach: "space.attachNameLabel",
};

export function SpaceFolderForm({
  intent,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  intent: SpaceFolderIntent;
  busy: boolean;
  error?: string;
  onCancel?: () => void;
  onSubmit: (input: { name?: string; rootPath?: string }) => void;
}) {
  const { t } = useTranslation();
  const bridge = getDesktopBridge();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const needsPath = intent !== "default";
  const canSubmit = intent === "default" ? !!name.trim() : !!rootPath.trim();
  const hintKey = intentHintKey[intent];
  const formError = error || pickerError;

  const pickDirectory = async () => {
    if (!bridge || picking) return;
    setPicking(true);
    setPickerError("");
    try {
      const selected = await bridge.pickSpaceDirectory();
      if (selected) setRootPath(selected);
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <header className="flex shrink-0 flex-col gap-0.5">
          <h2 className="text-base font-normal text-foreground">{t(`space.${intent}Title`)}</h2>
          {hintKey ? <p className="text-sm leading-snug text-muted-foreground">{t(hintKey)}</p> : null}
        </header>

        {needsPath ? (
          bridge ? (
            <div className="flex flex-col gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={pickDirectory}
                disabled={picking || busy}
              >
                <FolderOpen data-icon="inline-start" aria-hidden="true" />
                {picking ? t("space.selectingFolder") : t("space.selectFolder")}
              </Button>
              {rootPath ? (
                <p
                  className="truncate rounded-lg border border-border/45 bg-muted/15 px-3 py-2 font-mono text-xs text-muted-foreground"
                  title={rootPath}
                >
                  {rootPath}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("space.attachSubtitle")}</p>
              )}
            </div>
          ) : (
            <HostDirectoryPicker disabled={busy} onSelect={setRootPath} />
          )
        ) : null}

        {intent !== "relocate" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="space-folder-name">{t(intentNameLabelKey[intent])}</Label>
            <Input
              id="space-folder-name"
              autoFocus={intent === "default"}
              value={name}
              placeholder={intent === "attach" ? t("space.attachNamePlaceholder") : t("space.namePlaceholder")}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancel?.();
                if (event.key === "Enter" && canSubmit && !busy) {
                  onSubmit({ name: name.trim() || undefined, rootPath: rootPath.trim() || undefined });
                }
              }}
            />
          </div>
        ) : null}

        {formError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive" role="alert">
            {formError}
          </div>
        ) : null}
      </div>

      <footer className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border/40 pt-3">
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            {t("confirm.cancel")}
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => onSubmit({ name: name.trim() || undefined, rootPath: rootPath.trim() || undefined })}
        >
          {busy ? t("spacesModule.working") : t(intent === "relocate" ? "space.reconnectBtn" : "space.createBtn")}
        </Button>
      </footer>
    </div>
  );
}
