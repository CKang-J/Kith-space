import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface SpaceRenameDialogProps {
  currentName: string;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(name: string): void;
}

export function SpaceRenameDialog({ currentName, busy, error, onCancel, onConfirm }: SpaceRenameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const normalized = name.trim();
  const canSubmit = !!normalized && normalized !== currentName && !busy;
  const close = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) close();
    }}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(420px,calc(100vw-32px))] max-w-none gap-0 rounded-2xl bg-[var(--surface)] p-[22px] shadow-[0_18px_56px_var(--shadow-5)] ring-0 sm:max-w-none"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onConfirm(normalized);
          }}
        >
          <DialogHeader>
            <DialogTitle className="mb-4 [font-family:var(--serif)] text-[22px] leading-normal font-medium text-[var(--ink)]">
              {t("spacesModule.renameTitle")}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-0">
            <Field data-invalid={!!error} data-disabled={busy || undefined} className="gap-1.5">
              <FieldLabel
                htmlFor="spaces-rename-name"
                className="text-xs font-semibold text-[var(--body)]"
              >
                {t("spacesModule.nameLabel")}
              </FieldLabel>
              <Input
                id="spaces-rename-name"
                autoFocus
                value={name}
                maxLength={80}
                disabled={busy}
                aria-invalid={!!error}
                className="h-auto rounded-[9px] border-[var(--hair-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--ink)] focus-visible:border-[var(--tint-blue-ink)] focus-visible:ring-2 focus-visible:ring-[var(--tint-blue-strong)] md:text-[13px]"
                onChange={(event) => setName(event.target.value)}
              />
              {error ? (
                <FieldError className="mt-2 rounded-[9px] bg-[var(--error-soft)] px-[11px] py-[9px] text-xs text-[var(--error)]">
                  {error}
                </FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          <DialogFooter className="mx-0 mb-0 mt-[18px] flex-row justify-end gap-2 rounded-none border-0 bg-transparent p-0">
            <Button
              type="button"
              variant="outline"
              className="h-[34px] rounded-full px-3.5 text-xs font-semibold"
              onClick={close}
              disabled={busy}
            >
              {t("spacesModule.cancel")}
            </Button>
            <Button
              type="submit"
              className="h-[34px] rounded-full px-3.5 text-xs font-semibold"
              disabled={!canSubmit}
            >
              {busy ? t("spacesModule.renaming") : t("spacesModule.rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
