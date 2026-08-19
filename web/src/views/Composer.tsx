import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as RClipboardEvent, type DragEvent as RDragEvent } from "react";
import { ArrowUp, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, type Agent } from "../store.tsx";
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { autosizeComposerInput, observeComposerInputWidth } from "./composerAutosize.ts";
import { uniqueMentionedAgentIds } from "./composerTaskMentions.ts";
import { ComposerActions } from "./composer/ComposerActions.tsx";
import { ComposerAttachments, type PendingAttachment } from "./composer/ComposerAttachments.tsx";
import { ComposerCanvasContextList } from "./composer/ComposerCanvasContextList.tsx";
import { useComposerExpansion } from "./composer/useComposerExpansion.ts";
import { useComposerReserve } from "./composer/useComposerReserve.ts";
import {
  CHANNEL_ALL_MENTION_NAME,
  containsChannelAllMention,
  matchesChannelAllMentionQuery,
} from "./composerChannelAllMention.ts";
import { insertAgentMention } from "./composerMention.ts";
import { messageContextSnapshot } from "../messageContextSnapshot.ts";
import { ConversationActivityStatus } from "./ConversationActivityStatus.tsx";
import { useComposerCanvasContext } from "./composer/useComposerCanvasContext.ts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Shared message composer for channels, DMs, and threads. Owns text, attachment upload
// (button / paste / drag-drop, with per-file progress), @mention autocomplete, and send.
// The only per-context difference is task assignment (channels/DMs only), gated by `allowAsTask` —
// threads leave it falsy so a thread reply is never a task. Sending POSTs to `channelId`; the
// message echoes back over the socket, so the *parent* owns the message list + scroll, not this.
export interface ComposerHandle {
  mentionAgent(agentName: string): void;
}

interface ComposerProps {
  channelId: string;
  placeholder: string;       // base placeholder; when task assignment is active the component swaps in the task placeholder
  allowAsTask?: boolean;     // channels/DMs pass true → offer Assign Task + ⌘/Ctrl+Shift+Enter shortcut
  allowChannelAllMention?: boolean; // top-level channels and their topics only; DMs omit
  validateChannelTaskMentions?: boolean; // false for DMs: Agent assignment-by-mention is a channel-only contract
  dmAgent?: Agent;           // DM peer agent (channels/threads omit) → drives the single-peer sleeping nudge
  className?: string;        // extra class on the .composer root (threads pass "thread-composer")
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ channelId, placeholder, allowAsTask = false, allowChannelAllMention = false, validateChannelTaskMentions = true, dmAgent, className }, ref) {
  const { t } = useTranslation();
  const { api, spaceId, visibleAgents: agents, uploadOne, attachmentUrl } = useStore();
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const [text, setText] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [memoryExcluded, setMemoryExcluded] = useState(false);
  const [atQuery, setAtQuery] = useState<string | null>(null); // @ mention autocomplete: null = hidden
  const [atSel, setAtSel] = useState(0); // highlighted candidate index for ↑/↓ keyboard nav
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]); // uploaded attachments queued to send with the next message
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [taskMentionError, setTaskMentionError] = useState("");
  const canvas = useComposerCanvasContext({ channelId, api, dmAgent, t });
  const sendingRef = useRef(false);
  const atPosRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { boxRef, textNeedsExpansion } = useComposerExpansion(text, inputRef, asTask);
  const composerRootRef = useComposerReserve();
  useEffect(() => { const el = inputRef.current; if (el) autosizeComposerInput(el); }, [text]); // textarea auto-grows up to 160px
  useEffect(() => { const el = inputRef.current; return el ? observeComposerInputWidth(el) : undefined; }, []); // reflowed placeholders/drafts shrink again when a hidden Chat pane expands

  // Reachability hint as the input placeholder. Targets are the DM peer plus agents @-mentioned in the draft;
  // availability comes from agent lifecycle/activity, independent of the removed Machine product model.
  const reach = useMemo<{ kind: "sleep" | "work" | "on"; names: string } | null>(() => {
    const targets = new Map<string, Agent>();
    if (dmAgent) targets.set(dmAgent.id, dmAgent);
    for (const m of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) { const a = agents.find((x) => x.name === m[1]); if (a) targets.set(a.id, a); }
    const allTargets = [...targets.values()];
    const working = allTargets.filter((a) => { const st = a.activity || a.status; return st === "working" || st === "thinking"; });
    if (working.length) return { kind: "work", names: working.map((a) => a.displayName || a.name).join(", ") };
    const sleeping = allTargets.filter((a) => { const st = a.activity || a.status; return st === "sleeping" || st === "inactive" || st === "offline"; });
    if (sleeping.length) return { kind: "sleep", names: sleeping.map((a) => a.displayName || a.name).join(", ") };
    if (allTargets.length) return { kind: "on", names: allTargets.map((a) => a.displayName || a.name).join(", ") };
    return null;
  }, [text, dmAgent, agents]);
  const reachPlaceholder = reach ? (
    reach.kind === "work" ? t("chat.agentWorkingComposerPlaceholder", { name: reach.names }) :
    reach.kind === "on" ? t("chat.agentOnlineComposerPlaceholder", { name: reach.names }) :
    t("chat.agentSleepingComposerPlaceholder", { name: reach.names })
  ) : null;
  const effectivePlaceholder = reachPlaceholder ?? (allowAsTask && asTask ? t("chat.taskPlaceholder") : placeholder);
  const expanded = textNeedsExpansion || pendingAtts.length > 0 || canvas.canvasExpanded;

  const changeTaskMode = (active: boolean) => {
    setAsTask(active);
    setTaskMentionError("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useImperativeHandle(ref, () => ({
    mentionAgent(agentName: string) {
      const input = inputRef.current;
      const start = input?.selectionStart ?? text.length;
      const end = input?.selectionEnd ?? start;
      const insertion = insertAgentMention(text, start, end, agentName);
      setText(insertion.text);
      setAtQuery(null);
      setTaskMentionError("");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(insertion.caret, insertion.caret);
      });
    },
  }), [text]);

  const send = async (forceTask?: boolean) => {
    if (sendingRef.current) return;
    const v = text.trim(); if ((!v && !pendingAtts.length && !canvas.canvasContexts.length) || !channelId) return;
    const asT = allowAsTask && (forceTask ?? asTask); // ⌘/Ctrl+Shift+Enter forces task; threads (allowAsTask=false) never send as task
    if (asT) {
      if (containsChannelAllMention(v)) {
        setTaskMentionError(t("chat.taskChannelAllMention"));
        inputRef.current?.focus();
        return;
      }
      if (validateChannelTaskMentions && uniqueMentionedAgentIds(v, agents).length > 1) {
        setTaskMentionError(t("chat.taskMultipleAgentMentions"));
        inputRef.current?.focus();
        return;
      }
    }
    setTaskMentionError("");
    const canvasError = canvas.validateSend(asT);
    if (canvasError) {
      setTaskMentionError(canvasError);
      inputRef.current?.focus();
      return;
    }
    const ids = pendingAtts.filter((a) => a.status === "done" || !a.status).map((a) => a.id); // only fully-uploaded attachments
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await api("POST", "/api/messages", {
        channelId,
        content: v,
        asTask: asT,
        attachmentIds: ids,
        contextSnapshot: messageContextSnapshot(spaceId, channelId, className === "thread-composer"),
        memoryPolicy: memoryExcluded ? "exclude" : "eligible",
        ...canvas.buildSendPayload(),
      });
      if (result?.error) throw new Error(String(result.error));
      setText(""); setAtQuery(null); setAsTask(false); setMemoryExcluded(false); setPendingAtts([]);
      canvas.clearAfterSend();
    } catch (error) {
      setTaskMentionError(error instanceof Error ? error.message : String(error));
      inputRef.current?.focus();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ""; };
  // Each file → placeholder (images get a localUrl preview + "uploading") → uploadOne streams progress → replaced with the real attachment on success, "error" on failure. Paste: images only; drag-drop: any type.
  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files); if (!arr.length || !channelId) return;
    setUploading(true);
    try {
      for (const f of arr) {
        const tmpId = "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
        const localUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : "";
        setPendingAtts((p) => [...p, { id: tmpId, filename: f.name, mimeType: f.type, localUrl, status: "uploading", progress: 0 }]);
        try {
          const att = await uploadOne(channelId, f, (pct) => setPendingAtts((p) => p.map((x) => (x.id === tmpId ? { ...x, progress: pct } : x))));
          setPendingAtts((p) => p.map((x) => (x.id === tmpId ? { ...x, ...att, localUrl, status: "done", progress: 100 } : x)));
        } catch { setPendingAtts((p) => p.map((x) => (x.id === tmpId ? { ...x, status: "error" } : x))); }
      }
    } finally { setUploading(false); }
  };
  const onPaste = (e: RClipboardEvent) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/")).map((f, i) => new File([f], `pasted-${Date.now()}${i ? "-" + i : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type })); if (imgs.length) { e.preventDefault(); addFiles(imgs); } };
  const onDrop = (e: RDragEvent) => { const fs = Array.from(e.dataTransfer?.files ?? []); if (fs.length) { e.preventDefault(); addFiles(fs); } };

  // @ mention autocomplete: candidates are all current Space agents (not just current channel members) —
  // in a public channel, @-ing a non-member pulls them in (server-side auto-join), so suggesting them is intended.
  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value; setText(v); setTaskMentionError("");
    const pos = e.target.selectionStart ?? v.length;
    const m = /@([\p{L}\p{N}_-]*)$/u.exec(v.slice(0, pos)); // same Unicode class as the messageRender side (\p{L}): supports CJK and diacritic names
    if (m) { setAtQuery(m[1]); atPosRef.current = pos - m[0].length; } else setAtQuery(null);
    setAtSel(0); // typing narrows the list → restart highlight at the top
  };
  const cands = atQuery === null ? [] : [
    ...(allowChannelAllMention && !asTask && matchesChannelAllMentionQuery(atQuery)
      ? [{ name: CHANNEL_ALL_MENTION_NAME, label: t("chat.mentionEveryone"), kind: "channel_all" as const, avatarUrl: null }]
      : []),
    ...agents
      .map((agent) => ({ name: agent.name, label: agent.displayName || agent.name, kind: "agent" as const, avatarUrl: agent.avatarUrl }))
      .filter((candidate) => candidate.name && candidate.name.toLowerCase().includes((atQuery || "").toLowerCase())),
  ].slice(0, 8);
  const pick = (c: { name: string }) => {
    const start = atPosRef.current;
    const after = text.slice(start + 1 + (atQuery?.length ?? 0));
    setText(text.slice(0, start) + "@" + c.name + " " + after);
    setAtQuery(null); setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div ref={composerRootRef} className={"composer" + (expanded ? " composer--expanded" : "") + (className ? " " + className : "")} data-fly-land={`kith-chat:${channelId}`}>
      {atQuery !== null && cands.length > 0 && (
        <div className="mention-menu">
          {cands.map((c, i) => (
            <button key={c.kind + c.name} className={"mention-opt" + (i === atSel ? " sel" : "")} aria-selected={i === atSel}
              onPointerEnter={() => setAtSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              {c.kind === "channel_all"
                ? <span className="mention-broadcast-icon"><Users size={14} aria-hidden="true" /></span>
                : <Avatar seed={c.name} url={avFor(c.avatarUrl)} size={22} />}
              <span className="mention-opt-copy">
                <span className="mention-opt-label">{c.label}</span>
                <span className="mk-name">@{c.name}</span>
                {c.kind === "channel_all" ? <span className="mention-opt-desc">{t("chat.mentionEveryoneDescription")}</span> : null}
              </span>
              <span className="mk">{c.kind === "channel_all" ? t("chat.channelMentionKind") : "agent"}</span>
            </button>
          ))}
        </div>
      )}
      <input type="file" ref={fileRef} multiple style={{ display: "none" }} onChange={onPickFiles} />
      {taskMentionError ? <div className="composer-validation-error" role="alert">{taskMentionError}</div> : null}
      {canvas.executorLoadError && canvas.canvasContexts.length > 0 && !dmAgent ? <div className="composer-validation-error" role="alert">{canvas.executorLoadError}</div> : null}
      <ConversationActivityStatus channelId={channelId} />
      <div ref={boxRef} className={`composer-box ${expanded ? "is-expanded" : "is-compact"}`} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        {(pendingAtts.length > 0 || canvas.canvasExpanded) ? (
          <div className="composer-attachments">
            {pendingAtts.length > 0 ? (
              <ComposerAttachments
                attachments={pendingAtts}
                attachmentUrl={attachmentUrl}
                onRemove={(id) => setPendingAtts((pending) => pending.filter((attachment) => attachment.id !== id))}
              />
            ) : null}
            {canvas.selectionContexts.length > 0 ? (
              <ComposerCanvasContextList
                contexts={canvas.selectionContexts}
                onRemove={canvas.removeContext}
              />
            ) : null}
            {canvas.canvasContexts.length > 0 && !dmAgent && (canvas.selectionContexts.length > 0 || canvas.executorLoadError || (!canvas.executorAgentId && canvas.canvasExecutors.length > 1)) ? (
              <div className="composer-canvas-executor">
                <Select value={canvas.executorAgentId || undefined} onValueChange={canvas.setExecutorAgentId}>
                  <SelectTrigger size="sm" className="w-full max-w-64" data-canvas-executor-select>
                    <SelectValue placeholder={t("chat.canvasExecutorPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {canvas.canvasExecutors.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.displayName || agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
        <textarea className="composer-input" ref={inputRef} rows={1} value={text} onChange={onInput} onPaste={onPaste} readOnly={sending}
          placeholder={effectivePlaceholder}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return; // IME composition (CJK input): Enter selects a candidate, not send
            if (atQuery !== null && cands.length) { // @ menu open: ↑/↓ move highlight, Enter/Tab pick, Esc closes
              if (e.key === "ArrowDown") { e.preventDefault(); setAtSel((i) => Math.min(i + 1, cands.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setAtSel((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(cands[Math.min(atSel, cands.length - 1)]!); return; }
              if (e.key === "Escape") { e.preventDefault(); setAtQuery(null); return; }
            }
            if (e.key === "Enter") {
              if (allowAsTask && (e.metaKey || e.ctrlKey) && e.shiftKey) { e.preventDefault(); send(true); return; } // ⌘/Ctrl+Shift+Enter sends as a task (channels/DMs only)
              if (e.shiftKey) return; // Shift+Enter inserts a line break
              e.preventDefault(); send(); // Enter sends
            }
          }} />
        <div className="composer-bar">
          <div className="cb-left">
            <ComposerActions
              allowTask={allowAsTask}
              taskActive={asTask}
              memoryExcluded={memoryExcluded}
              canvasAvailable={canvas.canvasAvailable}
              canvasActive={canvas.canvasActive}
              canvasChips={canvas.wholeCanvasContexts.map((item) => ({
                id: item.id,
                canvasId: item.canvasId,
                canvasTitle: item.canvasTitle,
              }))}
              openCanvases={canvas.openCanvases}
              uploadDisabled={uploading || sending}
              taskDisabled={sending || canvas.canvasContexts.length > 0}
              memoryDisabled={sending}
              canvasDisabled={sending}
              onAddFiles={() => fileRef.current?.click()}
              onTaskChange={changeTaskMode}
              onMemoryExcludedChange={setMemoryExcluded}
              onCanvasChange={() => canvas.toggleCanvasAuthorization()}
              onToggleCanvas={canvas.toggleCanvas}
              onRemoveCanvas={canvas.removeContext}
            />
          </div>
          <div className="cb-right">
            <button className="send-btn" title={t("chat.sendTitle")} disabled={canvas.sendDisabled(sending, !!text.trim(), pendingAtts.length > 0)} onClick={() => send()}><ArrowUp size={17} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </div>
  );
});
