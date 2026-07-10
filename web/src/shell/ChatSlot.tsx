import { Chat } from "../views/Chat.tsx";

interface ChatSlotProps {
  compact?: boolean;
}

export function ChatSlot({ compact = false }: ChatSlotProps) {
  return (
    <section className={`shell-chat-slot${compact ? " shell-chat-slot--compact" : ""}`} aria-label={compact ? "群聊侧边条" : "群聊 C 位"}>
      <Chat embedded />
    </section>
  );
}
