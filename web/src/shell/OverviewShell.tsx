import { ArrowRight, Inbox, ListTodo, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store.tsx";
import { Inbox as InboxView } from "../views/misc.tsx";
import { shellActions } from "./shellStore.ts";

interface OverviewShellProps {
  legacyHref: string;
}

export function OverviewShell({ legacyHref }: OverviewShellProps) {
  const { serverId, servers } = useStore();
  const navigate = useNavigate();
  const activeServer = servers.find((server) => server.id === serverId);
  const enterSpace = (space: (typeof servers)[number]) => {
    shellActions.enterSpace(space.id);
    navigate(`/s/${space.slug}/channel`);
  };

  return (
    <main className="shell-overview">
      <header className="shell-overview__header">
        <div>
          <span className="shell-eyebrow">空间总览</span>
          <h1>Kith-space</h1>
        </div>
        <div className="shell-overview__actions">
          <a href={legacyHref}>现有界面</a>
          <button type="button" aria-label="设置（占位）"><Settings2 size={18} /></button>
        </div>
      </header>

      <div className="shell-bento" aria-label="总览占位区域">
        <section className="shell-bento__panel shell-bento__spaces">
          <div className="shell-bento__heading">
            <div>
              <span>我的空间</span>
              <p>选择一个空间进入协作内壳</p>
            </div>
            <span className="shell-bento__count">{servers.length}</span>
          </div>
          <div className="shell-space-list">
            {servers.map((space) => (
              <button key={space.id} type="button" onClick={() => enterSpace(space)}>
                <span>
                  <strong>{space.name}</strong>
                  <small>{space.slug}</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="shell-bento__panel">
          <div className="shell-bento__heading">
            <div>
              <span>全局收件箱</span>
              <p>{activeServer ? `${activeServer.name} 的近期消息` : "当前空间的近期消息"}</p>
            </div>
            <Inbox size={19} />
          </div>
          <InboxView embedded onNavigate={() => activeServer && shellActions.enterSpace(activeServer.id)} />
        </section>

        <section className="shell-bento__panel">
          <div className="shell-bento__heading">
            <div>
              <span>聚合待办</span>
              <p>跨空间任务占位</p>
            </div>
            <ListTodo size={19} />
          </div>
          <ul className="shell-placeholder-list">
            <li><span>今日待办</span><small>3 项占位</small></li>
            <li><span>待确认交付</span><small>1 项占位</small></li>
            <li><span>本周计划</span><small>稍后接入</small></li>
          </ul>
        </section>
      </div>
    </main>
  );
}
