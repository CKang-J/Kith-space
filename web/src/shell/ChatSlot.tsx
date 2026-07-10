import { Chat } from "../views/Chat.tsx";
import { Members } from "../views/Members.tsx";
import { Computers, Inbox, Search } from "../views/misc.tsx";
import { useShellStore, type MiddleView } from "./shellStore.ts";

interface ChatSlotProps {
  compact?: boolean;
}

export function ChatSlot({ compact = false }: ChatSlotProps) {
  const { middleView } = useShellStore();
  const content: Record<MiddleView, React.ReactNode> = {
    chat: <Chat embedded />,
    members: <Members />,
    machines: <Computers />,
    inbox: <Inbox />,
    search: <Search />,
  };

  return (
    <section className={`shell-chat-slot shell-chat-slot--${middleView}${compact ? " shell-chat-slot--compact" : ""}`} aria-label={compact ? "群聊侧边条" : "中间视图切换区"}>
      {content[middleView]}
    </section>
  );
}
