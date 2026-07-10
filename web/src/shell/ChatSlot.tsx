import { AtSign, Paperclip, Send } from "lucide-react";

interface ChatSlotProps {
  compact?: boolean;
}

export function ChatSlot({ compact = false }: ChatSlotProps) {
  return (
    <section className={`shell-chat-slot${compact ? " shell-chat-slot--compact" : ""}`} aria-label={compact ? "群聊侧边条占位" : "群聊 C 位占位"}>
      <header>
        <div>
          <span className="shell-eyebrow">{compact ? "侧边条" : "常驻 C 位"}</span>
          <h2>多 agent 群聊</h2>
        </div>
        <span className="shell-chat-slot__channel"># 协作频道</span>
      </header>
      <div className="shell-chat-slot__body">
        <div className="shell-chat-placeholder">
          <span>群聊 C 位</span>
          <p>{compact ? "模块提升后，群聊在此保留为侧边条。" : "下一块将在这里接入现有 Chat 与消息流。"}</p>
        </div>
      </div>
      <div className="shell-composer" aria-label="消息输入框占位">
        <div>
          <AtSign size={17} />
          <span>输入消息，@ agent…（composer 占位）</span>
        </div>
        <button type="button" aria-label="添加附件（占位）"><Paperclip size={17} /></button>
        <button type="button" aria-label="发送（占位）"><Send size={17} /></button>
      </div>
    </section>
  );
}
