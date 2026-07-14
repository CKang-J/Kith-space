import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Bell, BellOff } from "lucide-react";
import { useToast } from "../../toast.tsx";
import { responseError } from "./channelSettingsData.ts";
import type { ChannelNotificationLevel, ChannelSettingsApi } from "./types.ts";

interface ChannelNotificationSettingsProps {
  channelId: string;
  level: ChannelNotificationLevel;
  loading: boolean;
  loadError: string;
  readOnly?: boolean;
  api: ChannelSettingsApi;
  onLevelChange(level: ChannelNotificationLevel): void;
}

const OPTIONS = [
  { value: "all", icon: Bell },
  { value: "mentions", icon: AtSign },
  { value: "none", icon: BellOff },
] as const;

export function ChannelNotificationSettings({
  channelId,
  level,
  loading,
  loadError,
  readOnly = false,
  api,
  onLevelChange,
}: ChannelNotificationSettingsProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [saving, setSaving] = useState<ChannelNotificationLevel | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSaving(null);
    setError("");
  }, [channelId]);

  const update = async (next: ChannelNotificationLevel) => {
    if (next === level || saving || readOnly) return;
    setSaving(next);
    setError("");
    try {
      const result = await api("PATCH", `/api/channels/${encodeURIComponent(channelId)}/notification`, {
        notificationLevel: next,
      });
      const detail = responseError(result);
      if (detail) {
        setError(`${t("channelSettings.notifications.saveFailed")}: ${detail}`);
        return;
      }
      onLevelChange(next);
      toast.info(t("channelSettings.notifications.saveSuccess"));
    } catch {
      setError(t("channelSettings.notifications.saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="channel-settings__page channel-settings-notifications">
      {readOnly ? <p className="channel-settings__notice">{t("channelSettings.archivedSettingsReadOnly")}</p> : null}
      <p className="channel-settings-notifications__intro">{t("channelSettings.notifications.intro")}</p>
      <fieldset className="channel-settings__fieldset" disabled={loading || readOnly || saving !== null}>
        <legend className="channel-settings__sr-only">{t("channelSettings.notifications.title")}</legend>
        {OPTIONS.map(({ value, icon: Icon }) => (
          <label key={value} className="channel-settings__radio-row">
            <input
              type="radio"
              name={`channel-${channelId}-notification`}
              value={value}
              checked={level === value}
              onChange={() => void update(value)}
            />
            <Icon size={17} aria-hidden="true" />
            <span>
              <strong>{t(`channelSettings.notifications.options.${value}.title`)}</strong>
              <small>{t(`channelSettings.notifications.options.${value}.description`)}</small>
            </span>
            {saving === value ? <small className="channel-settings-notifications__saving">{t("channelSettings.notifications.saving")}</small> : null}
          </label>
        ))}
      </fieldset>
      {(error || loadError) ? <div className="channel-settings__error" role="alert">{error || loadError}</div> : null}
    </div>
  );
}
