import { ArrowRight, Inbox, ListTodo, Settings2 } from "lucide-react";
import { shellActions } from "./shellStore.ts";

interface OverviewShellProps {
  legacyHref: string;
}

const spaces = [
  { id: "product-space", name: "产品协作空间", note: "多 agent 协作占位" },
  { id: "personal-space", name: "个人中枢", note: "个人工作流占位" },
];

export function OverviewShell({ legacyHref }: OverviewShellProps) {
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
            <span className="shell-bento__count">2</span>
          </div>
          <div className="shell-space-list">
            {spaces.map((space) => (
              <button key={space.id} type="button" onClick={() => shellActions.enterSpace(space.id)}>
                <span>
                  <strong>{space.name}</strong>
                  <small>{space.note}</small>
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
              <p>跨空间消息聚合占位</p>
            </div>
            <Inbox size={19} />
          </div>
          <ul className="shell-placeholder-list">
            <li><span>@我的消息</span><small>3 条占位</small></li>
            <li><span>任务更新</span><small>1 条占位</small></li>
            <li><span>Agent 汇报</span><small>稍后接入</small></li>
          </ul>
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
