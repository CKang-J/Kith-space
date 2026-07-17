import { useMemo, useState } from "react";
import { ChevronRight, Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Channel } from "../store.tsx";
import { orderArchivedChannels } from "./archivedChannels.ts";

interface ArchivedChannelGroupProps {
  channels: Channel[];
  currentChannelId?: string;
  onSelect(channelId: string): void;
}

const archivedDate = (value: string | null | undefined, locale: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
};

export function ArchivedChannelGroup({ channels, currentChannelId, onSelect }: ArchivedChannelGroupProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(() => orderArchivedChannels(channels), [channels]);

  if (!ordered.length) return null;

  return (
    <section className="archived-channel-group">
      <button
        type="button"
        className="archived-channel-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight size={14} className={expanded ? "open" : ""} />
        <span className="grow">{t("channelSettings.archivedGroup")}</span>
        <span className="archived-channel-count">{ordered.length}</span>
      </button>
      {expanded ? (
        <div className="archived-channel-list">
          {ordered.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={"item archived-channel-row" + (channel.id === currentChannelId ? " active" : "")}
              aria-current={channel.id === currentChannelId ? "page" : undefined}
              onClick={() => onSelect(channel.id)}
            >
              <Hash size={14} className="channel-row-icon" aria-hidden="true" />
              <span className="grow">{channel.name}</span>
              {channel.archivedAt ? (
                <time className="meta" dateTime={channel.archivedAt} title={new Date(channel.archivedAt).toLocaleString(i18n.language)}>
                  {archivedDate(channel.archivedAt, i18n.language)}
                </time>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
