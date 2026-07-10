import { ArrowLeft, Hash, Inbox, LayoutGrid, MessageCircle, Monitor, Search, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store.tsx";
import { shellActions, useShellStore, type MiddleView } from "./shellStore.ts";

interface IconRailProps {
  legacyHref: string;
}

export function IconRail({ legacyHref }: IconRailProps) {
  const { channels, dms, unread, slug } = useStore();
  const { middleView } = useShellStore();
  const { channelId } = useParams();
  const navigate = useNavigate();
  const conversations = [
    ...channels.map((channel) => ({ ...channel, isDm: false })),
    ...dms.map((dm) => ({ ...dm, isDm: true })),
  ];
  const totalUnread = Object.values(unread).reduce((total, count) => total + count, 0);
  const openView = (view: MiddleView, path: string) => {
    shellActions.setMiddleView(view);
    navigate(`/s/${slug}/${path}`);
  };

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
              className={middleView === "chat" && channelId === conversation.id ? "is-active" : ""}
              aria-label={label}
              title={label}
              onClick={() => openView("chat", `channel/${conversation.id}`)}
            >
              {conversation.isDm ? <MessageCircle size={18} /> : <Hash size={18} />}
              {!!unread[conversation.id] && <span className="shell-rail-unread">{unread[conversation.id] > 99 ? "99+" : unread[conversation.id]}</span>}
            </button>
          );
        })}
      </div>
      <div className="shell-icon-rail__tools" aria-label="空间管理入口">
        <button type="button" className={middleView === "members" ? "is-active" : ""} aria-label="成员" title="成员" onClick={() => openView("members", "agent")}><Users size={19} /></button>
        <button type="button" className={middleView === "machines" ? "is-active" : ""} aria-label="机器" title="机器" onClick={() => openView("machines", "computer")}><Monitor size={19} /></button>
        <button type="button" className={middleView === "inbox" ? "is-active" : ""} aria-label="本空间收件箱" title="本空间收件箱" onClick={() => openView("inbox", "inbox")}>
          <Inbox size={19} />
          {totalUnread > 0 && <span className="shell-rail-unread">{totalUnread > 99 ? "99+" : totalUnread}</span>}
        </button>
        <button type="button" className={middleView === "search" ? "is-active" : ""} aria-label="搜索" title="搜索" onClick={() => openView("search", "search")}><Search size={19} /></button>
      </div>
      <div className="shell-icon-rail__spacer" />
      <a href={legacyHref} aria-label="打开现有界面" title="现有界面"><LayoutGrid size={19} /></a>
      <button type="button" aria-label="返回空间总览" title="返回总览" onClick={shellActions.returnToOverview}><ArrowLeft size={19} /></button>
    </nav>
  );
}
