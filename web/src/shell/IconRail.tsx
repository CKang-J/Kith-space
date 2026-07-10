import { ArrowLeft, Hash, LayoutGrid, MessageCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store.tsx";
import { shellActions } from "./shellStore.ts";

interface IconRailProps {
  legacyHref: string;
}

export function IconRail({ legacyHref }: IconRailProps) {
  const { channels, dms, unread, slug } = useStore();
  const { channelId } = useParams();
  const navigate = useNavigate();
  const conversations = [
    ...channels.map((channel) => ({ ...channel, isDm: false })),
    ...dms.map((dm) => ({ ...dm, isDm: true })),
  ];

  return (
    <nav className="shell-icon-rail" aria-label="空间导航">
      <button type="button" className="shell-icon-rail__brand" aria-label="返回空间总览" onClick={shellActions.returnToOverview}>
        K
      </button>
      <div className="shell-icon-rail__group" aria-label="频道与私聊入口">
        {conversations.map((conversation) => {
          const label = `${conversation.isDm ? "@" : "#"} ${conversation.name}`;
          return (
            <button
              key={conversation.id}
              type="button"
              className={channelId === conversation.id ? "is-active" : ""}
              aria-label={label}
              title={label}
              onClick={() => navigate(`/s/${slug}/channel/${conversation.id}`)}
            >
              {conversation.isDm ? <MessageCircle size={18} /> : <Hash size={18} />}
              {!!unread[conversation.id] && <span className="shell-rail-unread">{unread[conversation.id] > 99 ? "99+" : unread[conversation.id]}</span>}
            </button>
          );
        })}
      </div>
      <div className="shell-icon-rail__spacer" />
      <a href={legacyHref} aria-label="打开现有界面" title="现有界面"><LayoutGrid size={19} /></a>
      <button type="button" aria-label="返回空间总览" title="返回总览" onClick={shellActions.returnToOverview}><ArrowLeft size={19} /></button>
    </nav>
  );
}
