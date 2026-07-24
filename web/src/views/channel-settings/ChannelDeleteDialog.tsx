import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { matchesDeleteConfirmation } from "./channelSettingsData.ts";

interface ChannelDeleteDialogProps {
  channelName: string;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(): void;
}

export function ChannelDeleteDialog({
  channelName,
  busy,
  error,
  onCancel,
  onConfirm,
}: ChannelDeleteDialogProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);
  const matches = matchesDeleteConfirmation(confirmation, channelName);

  return (
    <AlertDialog open onOpenChange={(open) => {
      if (!open) close();
    }}>
      <AlertDialogContent
        className="channel-settings-delete-dialog w-[min(420px,calc(100vw-32px))] max-w-none gap-0 rounded-[14px] bg-[var(--surface)] p-[22px] shadow-[0_14px_48px_var(--shadow-5)] ring-0 data-[size=default]:max-w-none data-[size=default]:sm:max-w-none"
        overlayProps={{ onClick: close }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmationInputRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader className="block text-left">
          <AlertDialogTitle className="mb-2 text-[18px] leading-normal text-[var(--ink)]">
            {t("channelSettings.deleteConfirmTitle", { name: channelName })}
          </AlertDialogTitle>
          <AlertDialogDescription className="mb-4 text-[13px] leading-[1.55] text-[var(--muted)]">
            {t("channelSettings.deleteConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup className="gap-0">
          <Field data-invalid={!!error} data-disabled={busy || undefined} className="gap-1.5">
            <FieldLabel
              htmlFor="channel-settings-delete-confirmation"
              className="text-xs font-semibold text-[var(--body)]"
            >
              {t("channelSettings.deleteConfirmPrompt", { name: channelName })}
            </FieldLabel>
            <Input
              ref={confirmationInputRef}
              id="channel-settings-delete-confirmation"
              autoComplete="off"
              value={confirmation}
              disabled={busy}
              aria-invalid={!!error}
              className="h-auto rounded-[9px] border-[var(--hair-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] font-normal text-[var(--ink)] focus-visible:border-[var(--tint-blue-ink)] focus-visible:ring-2 focus-visible:ring-[var(--tint-blue-strong)] md:text-[13px]"
              onChange={(event) => setConfirmation(event.target.value)}
            />
            {error ? (
              <FieldError className="mt-2 rounded-[9px] border border-[var(--error-line)] bg-[var(--error-soft)] px-2.5 py-2 text-xs leading-[1.45] text-[var(--error)]">
                {error}
              </FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        <AlertDialogFooter className="mx-0 mb-0 mt-2 flex-row justify-end gap-2 rounded-none border-0 bg-transparent p-0">
          <AlertDialogCancel
            className="h-[34px] rounded-full px-3.5 text-xs font-semibold"
            disabled={busy}
          >
            {t("channelSettings.cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="h-[34px] rounded-full border border-[var(--error)] bg-[var(--error)] px-3.5 text-xs font-semibold text-[var(--on-ink)] hover:bg-[var(--error)] hover:text-[var(--on-ink)] hover:opacity-90"
            onClick={onConfirm}
            disabled={!matches || busy}
          >
            {busy ? t("channelSettings.deleting") : t("channelSettings.deleteChannel")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
