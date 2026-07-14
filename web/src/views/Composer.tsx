import { useState, useRef, useEffect, useMemo, type ChangeEvent, type ClipboardEvent as RClipboardEvent, type DragEvent as RDragEvent, type CSSProperties } from "react";
import { ImagePlus, Paperclip, Send, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, type Agent } from "../store.tsx";
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { IconFile } from "../icons.tsx";
import { autosizeComposerInput, observeComposerInputWidth } from "./composerAutosize.ts";
import { uniqueMentionedAgentIds } from "./composerTaskMentions.ts";

const isImage = (m?: string) => !!m && m.startsWith("image/");

// Shared message composer for channels, DMs, and threads. Owns text, attachment upload
// (button / paste / drag-drop, with per-file progress), @mention autocomplete, and send.
// The only per-context difference is "As Task" (channels/DMs only), gated by `allowAsTask` —
// threads leave it falsy so a thread reply is never a task. Sending POSTs to `channelId`; the
// message echoes back over the socket, so the *parent* owns the message list + scroll, not this.
export function Composer({ channelId, placeholder, allowAsTask = false, validateChannelTaskMentions = true, dmAgent, className }: {
  channelId: string;
  placeholder: string;       // base placeholder; when As Task is checked the component swaps in the task placeholder
  allowAsTask?: boolean;     // channels/DMs pass true → show the As Task toggle + ⌘/Ctrl+Shift+Enter shortcut
  validateChannelTaskMentions?: boolean; // false for DMs: Agent assignment-by-mention is a channel-only contract
  dmAgent?: Agent;           // DM peer agent (channels/threads omit) → drives the single-peer sleeping nudge
  className?: string;        // extra class on the .composer root (threads pass "thread-composer")
}) {
  const { t } = useTranslation();
  const { api, visibleAgents: agents, uploadOne, attachmentUrl } = useStore(); // visibleAgents: only real agents are @-mention candidates / reachability targets (not showcase demo props)
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const [text, setText] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [atQuery, setAtQuery] = useState<string | null>(null); // @ mention autocomplete: null = hidden
  const [atSel, setAtSel] = useState(0); // highlighted candidate index for ↑/↓ keyboard nav
  const [pendingAtts, setPendingAtts] = useState<any[]>([]); // uploaded attachments queued to send with the next message
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [taskMentionError, setTaskMentionError] = useState("");
  const sendingRef = useRef(false);
  const atPosRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  const send = async (forceTask?: boolean) => {
    if (sendingRef.current) return;
    const v = text.trim(); if ((!v && !pendingAtts.length) || !channelId) return;
    const asT = allowAsTask && (forceTask ?? asTask); // ⌘/Ctrl+Shift+Enter forces task; threads (allowAsTask=false) never send as task
    if (asT && validateChannelTaskMentions && uniqueMentionedAgentIds(v, agents).length > 1) {
      setTaskMentionError(t("chat.taskMultipleAgentMentions"));
      inputRef.current?.focus();
      return;
    }
    setTaskMentionError("");
    const ids = pendingAtts.filter((a) => a.status === "done" || !a.status).map((a) => a.id); // only fully-uploaded attachments
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await api("POST", "/api/messages", { channelId, content: v, asTask: asT, attachmentIds: ids });
      if (result?.error) throw new Error(String(result.error));
      setText(""); setAtQuery(null); setAsTask(false); setPendingAtts([]);
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
  const cands = atQuery === null ? [] : agents
    .map((agent) => ({ name: agent.name, label: agent.displayName || agent.name, kind: "agent", avatarUrl: agent.avatarUrl }))
    .filter((candidate) => candidate.name && candidate.name.toLowerCase().includes((atQuery || "").toLowerCase()))
    .slice(0, 8);
  const pick = (c: { name: string }) => {
    const start = atPosRef.current;
    const after = text.slice(start + 1 + (atQuery?.length ?? 0));
    setText(text.slice(0, start) + "@" + c.name + " " + after);
    setAtQuery(null); setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className={"composer" + (className ? " " + className : "")}>
      {atQuery !== null && cands.length > 0 && (
        <div className="mention-menu">
          {cands.map((c, i) => (
            <button key={c.kind + c.name} className={"mention-opt" + (i === atSel ? " sel" : "")} aria-selected={i === atSel}
              onMouseEnter={() => setAtSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              <Avatar seed={c.name} url={avFor(c.avatarUrl)} size={22} />
              <span className="grow">{c.label} <span className="mk-name">@{c.name}</span></span>
              <span className="mk">{c.kind === "agent" ? "agent" : t("chat.humanKind")}</span>
            </button>
          ))}
        </div>
      )}
      {pendingAtts.length > 0 && <div className="pending-atts">{pendingAtts.map((a) => {
        const img = isImage(a.mimeType);
        const src = a.localUrl || (a.status !== "uploading" ? attachmentUrl(a.id) : "");
        return <span key={a.id} className={"patt" + (img ? " patt-img" : "") + (a.status ? " st-" + a.status : "")} title={a.filename}>
          {img && src ? <img src={src} alt={a.filename} /> : <><IconFile size={13} />{!img && a.filename}</>}
          {a.status === "uploading" && <span className="patt-prog" style={{ ["--pct" as string]: (a.progress || 0) + "%" } as CSSProperties}>{a.progress || 0}%</span>}
          {a.status === "done" && <span className="patt-ok"><CheckCircle2 size={13} /></span>}
          {a.status === "error" && <span className="patt-err">!</span>}
          <button onClick={() => setPendingAtts((p) => p.filter((x) => x.id !== a.id))}>×</button>
        </span>;
      })}</div>}
      <input type="file" ref={imgRef} accept="image/*" multiple style={{ display: "none" }} onChange={onPickFiles} />
      <input type="file" ref={fileRef} multiple style={{ display: "none" }} onChange={onPickFiles} />
      {taskMentionError ? <div className="composer-validation-error" role="alert">{taskMentionError}</div> : null}
      <div className="composer-box" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
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
            <button className="cb-icon" title={t("chat.uploadImage")} disabled={uploading || sending} onClick={() => imgRef.current?.click()}><ImagePlus size={16} /></button>
            <button className="cb-icon" title={t("chat.uploadFile")} disabled={uploading || sending} onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
          </div>
          <div className="cb-right">
            {allowAsTask && <label className={"astask" + (asTask ? " on" : "")} title={t("chat.sendAsTaskTitle")}><input type="checkbox" checked={asTask} disabled={sending} onChange={(e) => { setAsTask(e.target.checked); setTaskMentionError(""); }} />{t("chat.asTask")}</label>}
            <button className="send-btn" title={t("chat.sendTitle")} disabled={sending || (!text.trim() && !pendingAtts.length)} onClick={() => send()}><Send size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
