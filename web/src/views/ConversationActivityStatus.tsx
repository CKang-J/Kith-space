import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  selectConversationActivity,
  type ConversationActivityEntry,
  type ConversationActivityPhase,
} from "../conversationActivity.ts";
import { useStore } from "../store.tsx";

const STATUS_STABILIZE_MS = 300;

function useStableActivity(activity: ReturnType<typeof selectConversationActivity>) {
  const [stable, setStable] = useState(activity);
  useEffect(() => {
    if (!activity) {
      setStable(null);
      return;
    }
    const timer = window.setTimeout(() => setStable(activity), STATUS_STABILIZE_MS);
    return () => window.clearTimeout(timer);
  }, [activity?.primary.agentId, activity?.primary.phase, activity?.primary.toolName, activity?.extraCount]);
  return stable;
}

export function ConversationActivityStatus({ channelId }: { channelId: string }) {
  const { t } = useTranslation();
  const { agents, conversationActivity, openAgentPanel } = useStore();
  const selected = useMemo(
    () => selectConversationActivity(conversationActivity[channelId]),
    [channelId, conversationActivity],
  );
  const activity = useStableActivity(selected);
  if (!activity) return null;

  const { primary, extraCount } = activity;
  const agent = agents.find((item) => item.id === primary.agentId);
  const name = agent?.displayName || agent?.name || primary.name;
  const text = activityText(primary, t);
  const moreText = extraCount > 0 ? t("chat.conversationActivity.more", { count: extraCount }) : "";
  const fullText = `${name} · ${text}${moreText ? ` · ${moreText}` : ""}`;

  return (
    <div
      data-testid="conversation-activity-status"
      className="mx-auto flex w-full max-w-[var(--chat-stream-max)] items-center px-3 pb-2 pt-1 text-xs leading-5 text-muted-foreground"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-none bg-transparent px-0 py-0 text-[12px] font-normal text-inherit shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent active:bg-transparent"
        aria-label={fullText}
        title={`${fullText} · ${t("chat.conversationActivity.view", { name })}`}
        onClick={() => openAgentPanel(primary.agentId)}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mr-2 size-1.5 shrink-0 rounded-full",
            activityDotClass(primary.phase),
            primary.phase !== "completed" && primary.phase !== "error" && "animate-pulse motion-reduce:animate-none",
          )}
        />
        <span className="max-w-[35%] shrink truncate text-muted-foreground">{name}</span>
        <span aria-hidden="true" className="mx-1.5 shrink-0 text-muted-foreground/60">·</span>
        <span className="min-w-0 flex-1 truncate text-left text-foreground/75">{text}</span>
        {extraCount > 0 ? (
          <span
            aria-hidden="true"
            className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] leading-none text-muted-foreground"
            title={moreText}
          >
            +{extraCount}
          </span>
        ) : null}
      </Button>
    </div>
  );
}

function activityText(
  activity: ConversationActivityEntry,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (activity.phase === "using_tool") {
    return t("chat.conversationActivity.usingTool", { tool: activity.toolName || t("chat.conversationActivity.tool") });
  }
  return t(`chat.conversationActivity.${activity.phase}`);
}

function activityDotClass(phase: ConversationActivityPhase): string {
  if (phase === "error") return "bg-destructive";
  if (phase === "completed") return "bg-[var(--success)]";
  if (phase === "waiting" || phase === "retrying" || phase === "thinking") return "bg-[var(--amber)]";
  return "bg-[var(--g-sky)]";
}
