import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import {
  Terminal,
  TerminalContent,
  TerminalHeader,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import { Avatar, resolveAvatar } from "@/Avatar";
import { agentStatusLabel } from "@/agentStatus";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type {
  TrajGroup,
  TrajGroupItem,
  TrajSource,
  TrajToolState,
} from "@/trajBuffer";
import {
  AtSignIcon,
  CircleAlertIcon,
  CircleIcon,
  HashIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
} from "lucide-react";
import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { groupTrajectorySteps } from "./trajectoryStepModel";

interface TrajectoryAgent {
  id: string;
  name: string;
  displayName?: string;
  avatarUrl?: string | null;
  activity?: string;
}

interface TrajectoryTimelineProps {
  groups: TrajGroup[];
  agents?: TrajectoryAgent[];
  attachmentUrl?: (id: string) => string;
  onOpenSource?: (source: TrajSource) => void;
  variant?: "aggregate" | "activity";
}

type ToolItem = Extract<TrajGroupItem, { kind: "tool" }>;

function parseToolInput(input?: string): unknown {
  if (!input) return {};
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function printableToolInput(input?: string): string {
  const parsed = parseToolInput(input);
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
}

function firstString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function toolSummary(item: ToolItem): {
  detail: string;
  shell: boolean;
} {
  const input = parseToolInput(item.toolInput);
  const name = item.toolName.toLowerCase();
  const shell = ["bash", "shell", "exec", "command", "terminal"].some((part) => name.includes(part));
  const detail = shell
    ? firstString(input, ["command", "cmd", "script"])
    : firstString(input, ["path", "file_path", "query", "pattern", "url"]);
  return { detail, shell };
}

function compact(value: string, limit = 72): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}…` : singleLine;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function toolStatus(
  item: ToolItem,
  live: boolean,
): ToolCallMessagePartStatus {
  if (item.toolState === "output-error") {
    return {
      type: "incomplete",
      reason: "error",
      error: item.toolOutput || "Tool call failed",
    };
  }
  if (item.toolState === "output-available") return { type: "complete" };
  if (live) return { type: "running" };
  return {
    type: "incomplete",
    reason: "error",
    error: "Tool call ended without a completion event",
  };
}

function StatusRow({ item }: { item: Extract<TrajGroupItem, { kind: "status" }> }) {
  const { t } = useTranslation();
  const label = item.activity ? agentStatusLabel(t, item.activity) : "";
  const detail = item.text && item.text !== item.activity ? item.text : "";
  return (
    <div className="flex min-w-0 items-center gap-2 py-1 !text-[length:var(--font-size-meta)] text-muted-foreground [&_*]:!text-[length:var(--font-size-meta)]">
      <CircleIcon aria-hidden className="size-1.5 fill-current" />
      <span className="truncate">{[label, detail].filter(Boolean).join(" · ")}</span>
      {item.createdAt ? <time className="ml-auto shrink-0">{formatTime(item.createdAt)}</time> : null}
    </div>
  );
}

function TextRow({
  item,
  showTime,
}: {
  item: Extract<TrajGroupItem, { kind: "text" }>;
  showTime: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const collapsible = showTime && (
    item.text.length > 320 || item.text.split("\n").length > 5
  );
  const body = (
    <p className="m-0 max-w-[72ch] whitespace-pre-wrap break-words">
      {item.text}
    </p>
  );

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 py-1 !text-[length:var(--font-size-meta)] leading-relaxed text-muted-foreground [&_*]:!text-[length:var(--font-size-meta)]">
      <MessageSquareTextIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {collapsible ? (
        <Collapsible className="min-w-0" onOpenChange={setOpen} open={open}>
          {open ? <CollapsibleContent>{body}</CollapsibleContent> : (
            <p className="m-0 line-clamp-4 max-w-[72ch] whitespace-pre-wrap break-words">
              {item.text}
            </p>
          )}
          <CollapsibleTrigger asChild>
            <Button className="-ml-2 mt-1" size="xs" variant="ghost">
              {open ? t("trajectory.collapseText") : t("trajectory.expandText")}
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
      ) : body}
      {showTime && item.createdAt
        ? <time className="shrink-0">{formatTime(item.createdAt)}</time>
        : null}
    </div>
  );
}

function ToolRow({
  item,
  live,
}: {
  item: ToolItem;
  live: boolean;
}) {
  const { t } = useTranslation();
  const summary = toolSummary(item);
  const output = item.toolOutput || "";
  const terminalText = [
    summary.detail ? `$ ${summary.detail}` : "",
    output,
  ].filter(Boolean).join("\n");

  return (
    <ToolFallbackRoot className="min-w-0" defaultOpen={false}>
      <ToolFallbackTrigger
        className="max-w-full !text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]"
        label={t("trajectory.usedTool")}
        status={toolStatus(item, live)}
        toolName={item.toolName}
      />
      <ToolFallbackContent className="!text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]">
        {summary.shell ? (
          <Terminal
            className="rounded-lg border-border bg-muted/40 text-foreground"
            isStreaming={item.toolState === "input-available" || item.toolState === "input-streaming"}
            output={terminalText}
          >
            <TerminalHeader className="border-border px-3 py-2">
              <TerminalTitle className="text-muted-foreground">{t("trajectory.shell")}</TerminalTitle>
            </TerminalHeader>
            <TerminalContent className="max-h-72 p-3 !text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]" />
          </Terminal>
        ) : (
          <>
            {item.toolInput ? (
              <ToolFallbackArgs
                argsText={printableToolInput(item.toolInput)}
                label={t("trajectory.parameters")}
              />
            ) : null}
            {item.toolState === "output-error" ? (
              <ToolFallbackResult
                className="[&_pre]:text-destructive"
                label={t("trajectory.error")}
                result={output || t("trajectory.toolFailed")}
              />
            ) : (
              <ToolFallbackResult
                label={t("trajectory.result")}
                result={output || undefined}
              />
            )}
          </>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
}

function ToolGroupRow({
  items,
  live,
}: {
  items: ToolItem[];
  live: boolean;
}) {
  const { t } = useTranslation();
  const active = live && items.some((item) => (
    item.toolState === "input-available" || item.toolState === "input-streaming"
  ));

  return (
    <ToolGroupRoot className="min-w-0" defaultOpen={active} variant="ghost">
      <ToolGroupTrigger
        active={active}
        className="min-h-7 max-w-full py-1 !text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]"
        count={items.length}
        label={t("trajectory.toolCalls", { count: items.length })}
      />
      <ToolGroupContent className="pl-5">
        {items.map((item, index) => (
          <ToolRow
            item={item}
            key={item.toolCallId || `${item.toolName}:${item.createdAt || index}`}
            live={live}
          />
        ))}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
}

function TraceItem({
  item,
  streaming,
  showTime,
}: {
  item: Exclude<TrajGroupItem, { kind: "tool" }>;
  streaming: boolean;
  showTime: boolean;
}) {
  const { t } = useTranslation();
  if (item.kind === "status") return <StatusRow item={item} />;
  if (item.kind === "thinking") {
    return (
      <ReasoningRoot className="mb-0" streaming={streaming} variant="ghost">
        <ReasoningTrigger
          active={streaming}
          className="min-h-7 max-w-full py-1 !text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]"
          label={streaming ? t("trajectory.thinking") : t("trajectory.thought")}
        />
        <ReasoningContent className="!text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]">
          <ReasoningText className="max-h-48 py-1.5 ps-5 !text-[length:var(--font-size-meta)] [&_*]:!text-[length:var(--font-size-meta)]">
            <p className="m-0 whitespace-pre-wrap break-words">{item.text}</p>
          </ReasoningText>
        </ReasoningContent>
      </ReasoningRoot>
    );
  }
  return <TextRow item={item} showTime={showTime} />;
}

function SourceButton({
  onOpen,
  source,
}: {
  onOpen?: (source: TrajSource) => void;
  source?: TrajSource | null;
}) {
  const { t } = useTranslation();
  const unavailable = !source || source.unavailable || !source.channelId;
  const Icon = source?.kind === "dm"
    ? AtSignIcon
    : source?.kind === "thread"
      ? MessagesSquareIcon
      : source?.kind === "channel"
        ? HashIcon
        : CircleAlertIcon;
  const label = !source
    ? t("trajectory.sourceUnrecorded")
    : source.unavailable
      ? t("trajectory.sourceUnavailable")
      : source.kind === "dm"
        ? source.name
          ? t("trajectory.dmSource", { name: source.name })
          : t("trajectory.dm")
        : source.kind === "thread"
          ? source.name
            ? t("trajectory.threadSource", {
              channel: source.name,
              topic: source.parentPreview || t("trajectory.thread"),
            })
            : t("trajectory.thread")
          : source.kind === "channel"
            ? `# ${source.name || t("trajectory.channel")}`
            : t("trajectory.sourceUnknown");

  return (
    <Button
      aria-label={label}
      className="-ml-2 h-7 min-w-0 max-w-full justify-start px-2 !text-[length:var(--font-size-meta)] font-normal text-muted-foreground [&_*]:!text-[length:var(--font-size-meta)]"
      disabled={unavailable}
      onClick={() => source && onOpen?.(source)}
      size="xs"
      title={label}
      variant="ghost"
    >
      <Icon aria-hidden data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function TrajectorySteps({
  items,
  live,
  showTime,
}: {
  items: TrajGroupItem[];
  live: boolean;
  showTime: boolean;
}) {
  const steps = groupTrajectorySteps(items);
  return (
    <div className="mt-1 flex min-w-0 flex-col">
      {steps.map((step, stepIndex) => {
        if (step.kind === "tool-group") {
          return (
            <ToolGroupRow
              items={step.items}
              key={`tools:${step.items[0]?.toolCallId || step.sourceIndex}`}
              live={live}
            />
          );
        }
        if (step.item.kind === "tool") {
          return (
            <ToolRow
              item={step.item}
              key={step.item.toolCallId || `tool:${step.sourceIndex}`}
              live={live}
            />
          );
        }
        return (
          <TraceItem
            item={step.item}
            key={`${step.item.kind}:${step.item.createdAt || step.sourceIndex}:${stepIndex}`}
            showTime={showTime}
            streaming={live && step.sourceIndex === items.length - 1}
          />
        );
      })}
    </div>
  );
}

export function TrajectoryTimeline({
  groups,
  agents = [],
  attachmentUrl,
  onOpenSource,
  variant = "aggregate",
}: TrajectoryTimelineProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.map((group, groupIndex) => {
        const agent = agents.find((item) => item.id === group.agentId)
          ?? agents.find((item) => (item.displayName || item.name) === group.name);
        const isTail = groupIndex === groups.length - 1;
        const live = isTail && (agent?.activity === "working" || agent?.activity === "thinking");
        const firstTime = group.items.find((item) => item.createdAt)?.createdAt;
        return (
          <section
            className={cn(
              "flex min-w-0 gap-2",
              variant === "activity" && "border-b border-border/70 pb-3 last:border-b-0",
            )}
            key={`${group.agentId || group.name || "agent"}:${group.streamId || groupIndex}:${groupIndex}`}
          >
            {variant === "aggregate" ? (
              <Avatar
                seed={group.name || "agent"}
                size={26}
                url={attachmentUrl
                  ? resolveAvatar(agent?.avatarUrl, attachmentUrl)
                  : agent?.avatarUrl}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <header className="flex min-w-0 items-center gap-2 text-muted-foreground">
                {variant === "activity"
                  ? <SourceButton onOpen={onOpenSource} source={group.source} />
                  : (
                    <span className="truncate !text-[length:var(--font-size-base)]">
                      {group.name ? `@${group.name}` : "Agent"}
                    </span>
                  )}
                {firstTime
                  ? (
                    <time className="ml-auto shrink-0 !text-[length:var(--font-size-meta)]">
                      {formatTime(firstTime)}
                    </time>
                  )
                  : null}
              </header>
              <TrajectorySteps
                items={group.items}
                live={live}
                showTime={variant === "activity"}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
