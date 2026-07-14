import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Lock } from "lucide-react";
import { useConfirm } from "../../ConfirmModal.tsx";
import { useToast } from "../../toast.tsx";
import {
  generalFormForChannel,
  isGeneralFormDirty,
  isRequiredChannel,
  responseError,
  type ChannelGeneralForm,
} from "./channelSettingsData.ts";
import type { ChannelSettingsApi, ChannelSettingsChannel } from "./types.ts";

interface ChannelGeneralSettingsProps {
  channel: ChannelSettingsChannel;
  api: ChannelSettingsApi;
  reload(): Promise<void>;
  readOnly?: boolean;
  onDirtyChange(dirty: boolean): void;
  onSaved?(channelId: string): void;
}

export function ChannelGeneralSettings({
  channel,
  api,
  reload,
  readOnly = false,
  onDirtyChange,
  onSaved,
}: ChannelGeneralSettingsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const formId = useId().replace(/:/g, "");
  const [saved, setSaved] = useState<ChannelGeneralForm>(() => generalFormForChannel(channel));
  const [form, setForm] = useState<ChannelGeneralForm>(() => generalFormForChannel(channel));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const required = isRequiredChannel(channel);
  const dirty = !readOnly && isGeneralFormDirty(form, saved);

  useEffect(() => {
    const next = generalFormForChannel(channel);
    setSaved(next);
    setForm(next);
    setError("");
  }, [channel.id, channel.name, channel.description, channel.type]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const setField = <K extends keyof ChannelGeneralForm>(key: K, value: ChannelGeneralForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const normalized: ChannelGeneralForm = {
      name: form.name.trim(),
      description: form.description.trim(),
      visibility: form.visibility,
    };
    if (!normalized.name || saving || readOnly) return;
    if (!required && normalized.visibility !== saved.visibility) {
      const accepted = await confirm({
        title: t("channelSettings.general.visibilityConfirmTitle"),
        message: t("channelSettings.general.visibilityConfirmDescription", {
          visibility: t(`channelSettings.general.visibility.${normalized.visibility}.title`),
        }),
        confirmLabel: t("channelSettings.general.confirmVisibility"),
      });
      if (!accepted) return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await api("PATCH", `/api/channels/${encodeURIComponent(channel.id)}`, required
        ? { description: normalized.description }
        : {
            name: normalized.name,
            description: normalized.description,
            visibility: normalized.visibility,
          });
      const detail = responseError(result);
      if (detail) {
        setError(`${t("channelSettings.general.saveFailed")}: ${detail}`);
        return;
      }
      setForm(normalized);
      setSaved(normalized);
      await reload();
      toast.info(t("channelSettings.general.saveSuccess"));
      onSaved?.(channel.id);
    } catch {
      setError(t("channelSettings.general.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="channel-settings__page channel-settings-general"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {readOnly ? <p className="channel-settings__notice">{t("channelSettings.archivedSettingsReadOnly")}</p> : null}
      {required ? <p className="channel-settings__notice">{t("channelSettings.general.requiredChannelNote")}</p> : null}

      <label className="channel-settings__field" htmlFor={`${formId}-name`}>
        <span>{t("channelSettings.general.name")}</span>
        <input
          id={`${formId}-name`}
          value={form.name}
          onChange={(event) => setField("name", event.target.value)}
          disabled={readOnly || required}
          autoComplete="off"
        />
      </label>

      <label className="channel-settings__field" htmlFor={`${formId}-description`}>
        <span>{t("channelSettings.general.description")}</span>
        <textarea
          id={`${formId}-description`}
          value={form.description}
          onChange={(event) => setField("description", event.target.value)}
          placeholder={t("channelSettings.general.descriptionPlaceholder")}
          disabled={readOnly}
          rows={5}
        />
      </label>

      <fieldset className="channel-settings__fieldset" disabled={readOnly || required}>
        <legend>{t("channelSettings.general.visibilityLabel")}</legend>
        {(["public", "private"] as const).map((visibility) => {
          const Icon = visibility === "public" ? Globe : Lock;
          return (
            <label key={visibility} className="channel-settings__radio-row">
              <input
                type="radio"
                name={`${formId}-visibility`}
                value={visibility}
                checked={form.visibility === visibility}
                onChange={() => setField("visibility", visibility)}
              />
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{t(`channelSettings.general.visibility.${visibility}.title`)}</strong>
                <small>{t(`channelSettings.general.visibility.${visibility}.description`)}</small>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error ? <div className="channel-settings__error" role="alert">{error}</div> : null}
      {!readOnly ? (
        <div className="channel-settings__form-actions">
          <button
            type="submit"
            className="channel-settings__button channel-settings__button--primary"
            disabled={!dirty || !form.name.trim() || saving}
          >
            {saving ? t("channelSettings.general.saving") : t("channelSettings.general.save")}
          </button>
        </div>
      ) : null}
    </form>
  );
}
