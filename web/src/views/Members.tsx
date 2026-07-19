import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Wrench } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useStore } from "../store.tsx";
import { fmtDateTime } from "../format";
import { Avatar, AvatarPicker, resolveAvatar } from "../Avatar.tsx";
import { Select } from "../Select.tsx";
import { useConfirm, useEscClose } from "../ConfirmModal.tsx";
import { useToast } from "../toast.tsx";
import i18n from "../i18n";
import { mergeWorkspaceSearch, workspaceLocationForModule, workspaceSearchForShellState } from "../shell/workspaceRoute.ts";
import { LOCAL_RUNTIME_DEFAULT, useRuntimeDiscovery } from "../useRuntimeDiscovery.ts";
import { agentStatusLabel } from "../agentStatus.ts";
import { SearchField } from "../components/SearchField.tsx";
import { AgentDefaultResponseModeCard } from "./agent-response-mode/AgentDefaultResponseModeCard.tsx";
import { normalizeAgentResponseMode } from "./agent-response-mode/responseModeModel.ts";
import { AgentMemoryPanel } from "./agent-memory/AgentMemoryPanel.tsx";

// Unified agent status label: fine-grained activity (working/thinking/online) takes priority;
// offline/absent falls back to lifecycle status (active/sleeping/inactive).
// Shared by sidebar and roster to keep both views in sync with Local Runtime activity.
function statusOf(a: { activity?: string | null; status: string }): string {
  return a.activity && a.activity !== "offline" ? a.activity : a.status;
}

interface AgentsProps {
  agentIdOverride?: string;
}

export function Agents({ agentIdOverride }: AgentsProps = {}) {
  const { t } = useTranslation();
  const { visibleAgents: agents, attachmentUrl } = useStore();
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const agentId = agentIdOverride;
  const nav = useNavigate();
  const location = useLocation();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filteredAgents = query
    ? agents.filter((agent) => [agent.name, agent.displayName, agent.description].some((value) => value?.toLowerCase().includes(query)))
    : agents;
  const openAgent = (agent: string | null) => nav(workspaceLocationForModule(
    location.pathname,
    location.search,
    { moduleId: "agents", agent },
  ));

  return (
    <>
      <aside className="sidebar agents-sidebar">
        <div className="sb-scroll">
        <div className="sb-title">{t("nav.agents")}</div>
        <SearchField
          className="agent-search"
          value={search}
          onValueChange={setSearch}
          placeholder={t("members.searchPlaceholder")}
          aria-label={t("members.searchPlaceholder")}
          clearLabel={t("members.searchClear")}
        />
        <div className="sec">{t("common.agents")} <span className="cnt">{agents.length}</span><button className="addbtn agents-create-button" title={t("members.createAgent")} onClick={() => setModal(true)}>+</button></div>
        {filteredAgents.map((a) => (
          <button key={a.id} className={"item agent-list-item" + (a.id === agentId ? " active" : "")} onClick={() => openAgent(a.id)}>
            <Avatar seed={a.name} url={avFor(a.avatarUrl)} size={20} /><span className="grow">{a.name}</span><span className={"dot " + statusOf(a)} role="img" aria-label={t("members.statusLabel", { status: agentStatusLabel(t, statusOf(a)) })} title={agentStatusLabel(t, statusOf(a))} />
          </button>
        ))}
        {query && filteredAgents.length === 0 && <div className="empty agent-search-empty">{t("members.searchEmpty")}</div>}
        </div>
      </aside>
      <main className="content-col">
        {agentId ? <AgentProfile id={agentId} onDeleted={() => openAgent(null)} /> : <Roster agents={agents} onCreate={() => setModal(true)} />}
      </main>
      {modal && <CreateAgentModal onClose={() => setModal(false)} />}
    </>
  );
}

function Roster({ agents, onCreate }: { agents: any[]; onCreate: () => void }) {
  const { t } = useTranslation();
  const { attachmentUrl } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const avFor = (u?: string | null) => resolveAvatar(u, attachmentUrl);
  const goKey = (e: React.KeyboardEvent, to: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav(to); } };
  return (
    <>
      <div className="head"><h1>{t("nav.agents")}</h1><small>{t("common.membersCount", { count: agents.length })}</small></div>
      <div className="scroll">
        {agents.length === 0 ? <div className="empty">{t("members.rosterEmpty")} {t("members.rosterEmptyCreate")} <button className="addbtn" onClick={onCreate}>+</button></div>
          : <>
            {agents.length > 0 && <div className="sec">{t("common.agents")} <span className="cnt">{agents.length}</span></div>}
            {agents.map((a) => {
              const to = workspaceLocationForModule(location.pathname, location.search, { moduleId: "agents", agent: a.id });
              const state = statusOf(a);
              return (
                <div className="card card-link" key={a.id} role="button" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => goKey(e, to)}>
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar seed={a.name} url={avFor(a.avatarUrl)} size={24} />{a.displayName || a.name} <small className="meta">@{a.name}</small></h3>
                  <div className="meta">{a.description || t("members.generalAgent")}</div>
                  <div className="kv"><b>{t("common.runtime")}</b> {a.runtime} · {a.model || t("members.useLocalDefault")}</div>
                  <div className="kv"><b>{t("common.status")}</b> {agentStatusLabel(t, state)}</div>
                </div>
              );
            })}
          </>}
      </div>
    </>
  );
}

export function AgentProfile({ id, onDeleted, onClose, onMessage }: { id: string; onDeleted: () => void; onClose?: () => void; onMessage?: () => void }) {
  const { t } = useTranslation();
  const { api, reload, onEvent, openAgentDM, slug, uploadAgentAvatar, attachmentUrl } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("agentTab") || "profile";
  const [a, setA] = useState<any>(null);
  const [edit, setEdit] = useState(false); const [dn, setDn] = useState(""); const [ds, setDs] = useState(""); // profile edit state (displayName/description)
  const [showRestart, setShowRestart] = useState(false);
  const [avBusy, setAvBusy] = useState(false); const [avErr, setAvErr] = useState(""); const [signedAvatar, setSignedAvatar] = useState<string | null>(null);
  const refetch = async () => { const data = await api("GET", "/api/agents/" + id); setA(data); setSignedAvatar(resolveAvatar(data?.avatarUrl, attachmentUrl)); };
  useEffect(() => { refetch(); }, [id]);
  useEffect(() => onEvent((e) => {
    if (e.type === "agent" && e.id === id) setA((p: any) => (p ? { ...p, status: e.status ?? p.status, activity: e.activity ?? p.activity } : p));
    else if (e.type === "agent:response-mode-updated" && e.agentId === id && !e.channelId) void refetch();
  }), [id]);
  const onPickAvatar = async (f: File) => { setAvBusy(true); setAvErr(""); try { const url = await uploadAgentAvatar(id, f); setSignedAvatar(url); await refetch(); await reload(); } catch (err: any) { setAvErr(String(err?.message || err)); } finally { setAvBusy(false); } };
  const onPickSeed = async (scheme: string) => { setAvBusy(true); setAvErr(""); try { await api("PATCH", "/api/agents/" + id, { avatarUrl: scheme }); await refetch(); await reload(); } catch (err: any) { setAvErr(String(err?.message || err)); } finally { setAvBusy(false); } };
  if (!a) return <div className="scroll"><div className="empty">{t("members.loading")}</div></div>;
  // Surface the Local Runtime's concrete 503 reason; unknown details remain more useful than a generic retry loop.
  const startFail = (r: any) => {
    if (!r?.error || r.error === "internal") return toast.error(t("members.startFailed"));
    toast.error(`${t("members.startFailedWithReason")}: ${r.error}`);
  };
  const ctl = async (action: string) => { const r = await api("POST", `/api/agents/${id}/${action}`); if (r?.error) startFail(r); setTimeout(refetch, 400); }; // start/stop: surface daemon-offline failure (503 → {error}) instead of swallowing it
  // Three restart modes: restart keeps the session; reset clears session/runtime state; full also clears this Agent's memory. Shared Space files are always preserved.
  const doRestart = async (mode: "restart" | "reset" | "full") => {
    setShowRestart(false);
    let r: any;
    if (mode === "restart") r = await api("POST", `/api/agents/${id}/restart`);
    else if (mode === "reset") r = await api("POST", `/api/agents/${id}/reset`, { restart: true });
    else r = await api("POST", `/api/agents/${id}/reset`, { clearAgentMemory: true, restart: true });
    if (r?.error) startFail(r); // pure restart returns 503 when daemon offline; reset/full return ok (restart leg stays best-effort)
    setTimeout(refetch, 500);
  };
  const del = async () => { if (!(await confirm({ title: t("members.deleteAgentTitle", { name: a.name }), message: t("members.deleteAgentMessage"), confirmLabel: t("members.delete"), danger: true }))) return; await api("DELETE", "/api/agents/" + id); await reload(); onDeleted(); };
  const startEdit = () => { setDn(a.displayName || a.name); setDs(a.description || ""); setEdit(true); };
  const saveProfile = async () => { await api("PATCH", "/api/agents/" + id, { displayName: dn.trim() || a.name, description: ds.trim() }); setEdit(false); await refetch(); await reload(); }; // profile tab: editable displayName/description
  const live = statusOf(a);
  const msgAgent = async () => {
    const cid = await openAgentDM(id);
    if (!cid) return;
    const discussionSearch = workspaceSearchForShellState(location.search, { activeModule: "agents", chatVisible: true });
    nav(mergeWorkspaceSearch(`/s/${slug}/channel/${cid}`, discussionSearch));
  };
  const acts = (
    <div className="agent-acts">
      <button className="joinbtn" onClick={onMessage ?? msgAgent}><MessageCircle size={13} style={{ verticalAlign: "-2px" }} /> {t("members.dm")}</button>
      <button className="joinbtn" onClick={() => ctl(a.status === "active" ? "stop" : "start")}>{a.status === "active" ? t("members.stop") : t("members.start")}</button>
      <button className="joinbtn" onClick={() => setShowRestart(true)}>{t("members.restart")}</button>
      <button className="joinbtn" style={{ color: "var(--error)" }} onClick={del}>{t("members.delete")}</button>
    </div>
  );
  return (
    <>
      {onClose ? ( // panel mode (embedded in chat right sidebar: click avatar → profile panel)
        <div className="profile-panel-head">
          <Avatar seed={a.name} url={signedAvatar} size={28} />
          <div className="pph-id"><span className="pph-name">{a.displayName || a.name} <span className={"dot " + live} /></span><span className="pph-handle">@{a.name}</span></div>
          <button className="joinbtn pph-close" title={t("members.close")} onClick={onClose}><X size={14} /></button>
          {acts}
        </div>
      ) : <div className="head head-agent"><AvatarPicker name={a.name} url={signedAvatar} size={48} editable busy={avBusy} onPickSeed={onPickSeed} onPickFile={onPickAvatar} /><div className="head-id"><h1>{a.displayName || a.name}</h1><small>@{a.name} <span className={"dot " + live} />{avErr ? <span className="form-err" style={{ marginLeft: 8 }}>{avErr}</span> : null}</small></div>{acts}</div>}
      <div className="ptabs">
        {/* Tab order follows AgentDetailPanel spec: integrations (not apps) */}
        {([
          ["profile", t("members.tabProfile")],
          ["permissions", t("members.tabPermissions")],
          ["dms", t("members.tabDms")],
          ["reminders", t("members.tabReminders")],
          ["workspace", t("members.tabMemory")], // keep the query value for existing agentTab=workspace deep links
          ["integrations", t("members.tabIntegrations")],
          ["activity", t("members.tabActivity")],
        ] as [string, string][]).map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setSp((prev) => { const n = new URLSearchParams(prev); n.set("agentTab", k); return n; })}>{label}</button>
        ))}
      </div>
      {tab === "workspace" ? <AgentMemoryPanel agentId={id} />
        : tab === "activity" ? <ActivityTab id={id} name={a.name} />
        : tab === "permissions" ? <PermissionsTab id={id} />
        : tab === "integrations" ? <AppsTab id={id} />
        : tab === "dms" ? <DmsTab id={id} name={a.name} />
        : tab === "reminders" ? <RemindersTab id={id} name={a.name} />
        : (
          <div className="scroll">
            <div className="card">
              <div className="meta">{a.description || t("members.generalAgent")}</div>
              <div className="kv"><b>{t("common.runtime")}</b> {a.runtime}</div>
              <div className="kv"><b>{t("common.model")}</b> {a.model || t("members.useLocalDefault")}</div>
              {a.runtimeConfig?.reasoningEffort && <div className="kv"><b>{t("common.reasoning")}</b> {a.runtimeConfig.reasoningEffort}</div>}
                <div className="kv"><b>{t("common.status")}</b> <span className="kv-v"><span className={"dot " + live} /> {agentStatusLabel(t, live)}</span></div>
              <div className="kv"><b>{t("common.session")}</b> {a.sessionId || "(none)"}</div>
              <div className="kv"><b>{t("common.memory")}</b> <AgentMemoryRoot id={a.id} /></div>
              {a.createdAt && <div className="kv"><b>{t("common.created")}</b> {fmtDateTime(a.createdAt)}</div>}
              <div className="task-acts" style={{ marginTop: 14 }}>
                <button className="joinbtn" onClick={startEdit}>{t("members.editProfile")}</button>
              </div>
            </div>
            <AgentDefaultResponseModeCard
              agentId={id}
              value={normalizeAgentResponseMode(a.defaultResponseMode)}
              onSaved={(defaultResponseMode) => setA((current: any) => current ? { ...current, defaultResponseMode } : current)}
            />
            <SkillsSection id={id} />
          </div>
        )}
      {edit && <AgentProfileEditModal name={a.name} displayName={dn} description={ds} onDisplayNameChange={setDn} onDescriptionChange={setDs} onClose={() => setEdit(false)} onSave={saveProfile} />}
      {showRestart && <RestartModal name={a.displayName || a.name} onClose={() => setShowRestart(false)} onPick={doRestart} />}
    </>
  );
}

// Profile tab SKILLS section (GET /api/agents/:id/skills — Local Runtime reads locally installed skills)
function SkillsSection({ id }: { id: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const [d, setD] = useState<{ global: any[]; workspace: any[] } | null>(null);
  useEffect(() => { (async () => { try { setD(await api("GET", `/api/agents/${id}/skills`)); } catch { setD({ global: [], workspace: [] }); } })(); }, [id]);
  if (!d) return null;
  const all = [...(d.workspace || []).map((s) => ({ ...s, scope: t("members.scopeWorkspace") })), ...(d.global || []).map((s) => ({ ...s, scope: t("members.scopeGlobal") }))];
  return (
    <>
      <div className="sec">{t("common.skills")} <span className="cnt">{all.length}</span></div>
      {all.length === 0 ? <div className="empty">{t("members.skillsEmpty")}</div>
        : all.map((s, i) => (
          <div className="card skill-row" key={i} title={`${s.displayName || s.name}${s.description ? "\n\n" + s.description : ""}`}>
            <div className="who">{s.displayName || s.name} <span className="meta">· {s.scope}{s.userInvocable ? ` · ${t("members.skillInvocable")}` : ""}</span></div>
            {s.description ? <div className="meta skill-desc">{s.description}</div> : <div className="meta" style={{ opacity: .6 }}>{t("members.noDescription")}</div>}
          </div>
        ))}
    </>
  );
}

// Permissions tab (GET/PUT /api/agents/:id/scopes — grouped scope checkboxes with enforcement)
function PermissionsTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const [data, setData] = useState<any>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  useEffect(() => { (async () => { const d = await api("GET", `/api/agents/${id}/scopes`); setData(d); setGranted(new Set(d.granted || [])); })(); }, [id]);
  if (!data) return <div className="scroll"><div className="empty">{t("members.loading")}</div></div>;
  const toggle = (k: string) => setGranted((g) => { const n = new Set(g); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const save = async (scopes: string[]) => { const d = await api("PUT", `/api/agents/${id}/scopes`, { scopes }); setData({ ...data, ...d }); setGranted(new Set(d.granted || [])); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const groups: Record<string, any[]> = {};
  for (const s of data.catalog || []) (groups[s.group] ||= []).push(s);
  return (
    <div className="scroll">
      <div className="perm-head">
        <span className="meta">{data.mode === "custom" ? t("members.permCustom") : t("members.permDefault")} · rev {data.revision}</span>
        <button className="joinbtn" onClick={() => save((data.catalog || []).map((s: any) => s.key))}>{t("members.grantAll")}</button>
        <button className="ok" style={{ marginLeft: "auto" }} onClick={() => save([...granted])}>{t("members.save")}</button>
        {saved && <span className="saved">{t("members.savedConfirm")}</span>}
      </div>
      {Object.entries(groups).map(([g, list]) => (
        <div key={g} className="perm-group">
          <div className="sec sec-sub">{t(`members.permissionGroups.${g}`, { defaultValue: g })}</div>
          {list.map((s: any) => (
            <label key={s.key} className="perm-row">
              <input type="checkbox" checked={granted.has(s.key)} onChange={() => toggle(s.key)} />
              <span className="grow"><span className="who">{t(`members.permissions.${s.key.replace(":", "_")}.label`, { defaultValue: s.label })}</span> <code className="perm-key">{s.key}</code><div className="meta">{t(`members.permissions.${s.key.replace(":", "_")}.description`, { defaultValue: s.description })}</div></span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

// Integrations tab (connected third-party integrations, GET /api/integrations/agents/:id; empty state when none configured)
function AppsTab({ id }: { id: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const [apps, setApps] = useState<any[] | null>(null);
  useEffect(() => { (async () => { try { setApps(await api("GET", `/api/integrations/agents/${id}`)); } catch { setApps([]); } })(); }, [id]);
  return <div className="scroll"><div className="sec">{t("members.connectedApps")}</div>{!apps?.length ? <div className="empty">{t("members.appsEmpty")}</div> : apps.map((ap, i) => <div className="card" key={i}><div className="who">{ap.name || ap.id}</div></div>)}</div>;
}

// DMs tab (derived from channels: direct message threads between this agent and others)
function DmsTab({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const { api, slug } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const [dms, setDms] = useState<any[] | null>(null);
  useEffect(() => { (async () => { try { setDms(await api("GET", `/api/agents/${id}/agent-dms`)); } catch { setDms([]); } })(); }, [id]);
  const openDiscussion = (channelId: string) => {
    const discussionSearch = workspaceSearchForShellState(location.search, { activeModule: "agents", chatVisible: true });
    nav(mergeWorkspaceSearch(`/s/${slug}/channel/${channelId}`, discussionSearch));
  };
  return <div className="scroll"><div className="sec">{t("members.agentDms")}</div>{!dms?.length ? <div className="empty">{t("members.dmsEmpty", { name })}</div> : dms.map((d) => <button className="item" key={d.id} onClick={() => openDiscussion(d.id)}><Avatar seed={d.name} size={22} /><span className="grow">{d.name}</span></button>)}</div>;
}

// Reminders tab (read-only in the Human UI; agents create reminders through their runtime)
const REM_STATUS: Record<string, string> = {
  scheduled: i18n.t("members.remScheduled"),
  fired: i18n.t("members.remFired"),
  cancelled: i18n.t("members.remCancelled"),
};
function RemindersTab({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const [rem, setRem] = useState<any[] | null>(null);
  useEffect(() => { (async () => { try { const d = await api("GET", `/api/reminders?ownerAgentId=${id}`); setRem(d?.reminders || []); } catch { setRem([]); } })(); }, [id]);
  const scheduled = (rem || []).filter((r) => r.status === "scheduled").length;
  return <div className="scroll"><div className="sec">{t("members.remindersTitle")} {rem?.length ? <span className="cnt">{t("members.remindersCount", { scheduled, total: rem.length })}</span> : null}</div>
    {!rem?.length ? <div className="empty">{t("members.remindersEmpty", { name })}</div>
      : rem.map((r) => (
        <div className="card" key={r.id}>
          <div className="who">{r.content}{r.recurrence ? <span className="meta"> · {t("members.recurrenceEvery", { seconds: r.recurrence })}</span> : null}</div>
          <div className="meta"><span className={"rem-badge " + (r.status || "scheduled")}>{REM_STATUS[r.status] || r.status}</span> · {fmtDateTime(r.remindAt)}</div>
        </div>
      ))}</div>;
}

// Activity timeline (GET /api/agents/:id/activity-log for history + live-appended via agent:activity/trajectory events)
function ActivityTab({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const { api, onEvent } = useStore();
  const [items, setItems] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { (async () => { const d = await api("GET", `/api/agents/${id}/activity-log?limit=120`); setItems(Array.isArray(d) ? d : []); })(); }, [id]);
  useEffect(() => onEvent((e) => {
    if (e.type === "agent" && e.id === id && e.activity) setItems((x) => [...x, { timestamp: Date.now(), entry: { kind: "status", activity: e.activity, detail: e.detail } }]);
    else if (e.type === "trajectory" && e.agentId === id) setItems((x) => [...x, ...(e.entries || []).map((en: any) => ({ timestamp: Date.now(), entry: { kind: en.kind === "tool" ? "tool_start" : (en.kind || (en.toolName ? "tool_start" : "text")), text: en.text, toolName: en.toolName, toolInput: en.toolInput, activity: en.activity, detail: en.detail } }))]);
  }), [id]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [items]);
  const time = (ts: number) => { try { return new Date(ts).toLocaleTimeString(undefined, { hour12: false }); } catch { return ""; } };
  const entryOf = (e: any) => ({ ...e, kind: e.kind === "tool" ? "tool_start" : e.kind });
  const visible = (e: any) => !(e.kind === "status" && !e.activity && !e.detail) && !(e.kind === "tool_start" && e.toolName === "agentMessage" && !e.text);
  return (
    <div className="scroll" ref={scrollRef}>
      {items.length === 0 ? <div className="empty">{t("members.activityEmpty", { name })}</div>
        : <div className="actlog">{items.filter((it) => visible(entryOf(it.entry))).map((it, i) => {
          const e = entryOf(it.entry); const t2 = time(it.timestamp);
          if (e.kind === "tool_start") return <div className="act" key={i}><span className="act-t">{t2}</span><span className="act-tool"><Wrench size={11} /> {e.toolName}</span><span className="act-x mono">{e.toolInput}</span></div>;
          if (e.kind === "text") return <div className="act" key={i}><span className="act-t">{t2}</span><span className="act-x">{e.text}</span></div>;
          return <div className="act" key={i}><span className="act-t">{t2}</span><span className={"dot " + (e.activity || "")} /><span className="act-x muted">{agentStatusLabel(t, e.activity)}{e.detail ? " · " + e.detail : ""}</span></div>;
        })}</div>}
    </div>
  );
}

// Agent Memory file tree. The legacy workspace-files route names remain compatible with existing clients.
// .md files: Preview (rendered markdown, default) / Raw (monospace source) toggle. Other files: monospace source only.
function AgentMemoryRoot({ id }: { id: string }) {
  const { api } = useStore();
  const [root, setRoot] = useState("...");
  useEffect(() => {
    let active = true;
    setRoot("...");
    void api("GET", `/api/agents/${id}/workspace-files`).then((result) => {
      if (active && result.root) setRoot(result.root);
    });
    return () => { active = false; };
  }, [id]);
  return <>{root}</>;
}

function AgentProfileEditModal({ name, displayName, description, onDisplayNameChange, onDescriptionChange, onClose, onSave }: {
  name: string; displayName: string; description: string;
  onDisplayNameChange: (value: string) => void; onDescriptionChange: (value: string) => void;
  onClose: () => void; onSave: () => void;
}) {
  const { t } = useTranslation();
  useEscClose(onClose);
  return (
    <div className="modal-bg profile-edit-bg" onClick={onClose}>
      <div className="modal profile-edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("members.editProfile")}</h3>
        <div className="setform">
          <label>{t("members.displayName")}</label>
          <input value={displayName} onChange={(e) => onDisplayNameChange(e.target.value)} placeholder={name} />
          <label>{t("members.agentDescriptionLabel")}</label>
          <textarea value={description} maxLength={3000} onChange={(e) => onDescriptionChange(e.target.value)} placeholder={t("members.agentDescriptionPlaceholder")} />
          <div className="ta-count">{description.trim().length}/3000</div>
        </div>
        <div className="acts"><button className="ok" onClick={onSave}>{t("members.save")}</button><button className="cancel" onClick={onClose}>{t("members.cancel")}</button></div>
      </div>
    </div>
  );
}

export function CreateAgentModal({ onClose, prefill, onCreated }: { onClose: () => void; prefill?: { name?: string; description?: string }; onCreated?: (r: { id: string; name: string }) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  useEscClose(onClose);
  const { api, reload } = useStore();
  const [name, setName] = useState(prefill?.name ?? ""); const [desc, setDesc] = useState(prefill?.description ?? "");
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const {
    runtime, setRuntime, runtimeOptions, runtimesLoading, runtimeError, runtimeInstalled,
    supportsLocalDefault, model, models, modelsLoading, modelError, selectModel, retryModels,
    reasoning, setReasoning,
  } = useRuntimeDiscovery(api);
  const create = async () => {
    const nm = name.trim();
    if (!nm) { setErr(t("members.nameRequired")); return; }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(nm) || nm.length > 64) { setErr(t("members.nameInvalid")); return; } // @mention handle must be token-safe; keep regex + length 64 in sync with core.ts AGENT_NAME_RE / MAX_AGENT_NAME
    if (!runtimeInstalled) { setErr(t("members.runtimeUnavailable")); return; }
    if (!model) { setErr(t("members.modelRequired")); return; }
    setBusy(true); setErr("");
    try {
      const r = await api("POST", "/api/agents", { name: nm, description: desc.trim() || null, runtime, model: model && model !== LOCAL_RUNTIME_DEFAULT ? model : null, reasoning: thinkingLevels.length ? (reasoning || null) : null, fastMode: fast });
      if (r?.error) { setErr(r.error); return; }
      await reload();
      if (r?.id) { if (r.started === false) toast.info(t("members.agentCreatedOffline")); onCreated?.({ id: r.id, name: r.name ?? nm }); }
      onClose();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
  const selModel = models.find((m) => m.id === model);
  const thinkingLevels = selModel?.thinking?.levels ?? [];
  const modelOpts = [
    ...(supportsLocalDefault ? [{ value: LOCAL_RUNTIME_DEFAULT, label: t("members.useLocalDefault") }] : []),
    ...(models.length
      ? models.map((m) => ({ value: m.id, label: m.label || m.id }))
      : []),
  ];
  const modelLoadingOpts = [{ value: "", label: t("members.detectingModels"), disabled: true }];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("members.createAgentTitle")}</h3>
        <label>{t("members.nameLabel")}</label><input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder={t("members.namePlaceholder")} />
        <label>{t("members.descriptionLabel")}</label><textarea value={desc} maxLength={3000} onChange={(e) => setDesc(e.target.value)} placeholder={t("members.descriptionPlaceholder")} />
        <label>Runtime</label>
        <fieldset disabled={runtimesLoading} style={{ border: 0, padding: 0, margin: 0, opacity: runtimesLoading ? 0.6 : 1 }}>
          <Select ariaLabel="Runtime" value={runtime} options={runtimeOptions} onChange={setRuntime} placeholder={runtimesLoading ? t("members.detectingRuntimes") : undefined} />
        </fieldset>
        {runtimeError && <div className="form-err">{runtimeError}</div>}
        <label>{t("common.model")}</label>
        {/* During probe flight: disable interaction and show a localized detection placeholder. */}
        <fieldset disabled={modelsLoading || !runtimeInstalled} style={{ border: 0, padding: 0, margin: 0, opacity: modelsLoading || !runtimeInstalled ? 0.6 : 1 }}>
          <Select ariaLabel="Model" value={modelsLoading ? "" : model} options={modelsLoading ? modelLoadingOpts : modelOpts} onChange={selectModel} placeholder={modelError || undefined} />
        </fieldset>
        {modelError && <div className="form-err">{modelError} <button type="button" className="cancel" onClick={retryModels}>{t("members.retryModelDetection")}</button></div>}
        {thinkingLevels.length > 0 && <>
          <label>{t("members.reasoningLabel")}</label>
          <Select ariaLabel="Reasoning" value={reasoning} onChange={setReasoning}
            options={[{ value: "", label: t("members.reasoningDefault") }, ...thinkingLevels.map((l) => ({ value: l.value, label: l.label }))]} />
        </>}
        <label className="ck-row"><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /><span>{t("members.fastMode")}</span></label>
        {err && <div className="form-err">{err}</div>}
        <div className="acts"><button className="cancel" onClick={onClose}>{t("members.cancel")}</button><button className="ok" onClick={create} disabled={busy || runtimesLoading || modelsLoading || !runtimeInstalled || !model}>{busy ? t("members.creating") : t("members.create")}</button></div>
      </div>
    </div>
  );
}

// Three-mode restart modal: Restart / Reset Session & Restart / Full Reset & Restart
function RestartModal({ name, onClose, onPick }: { name: string; onClose: () => void; onPick: (mode: "restart" | "reset" | "full") => void }) {
  const { t } = useTranslation();
  useEscClose(onClose);
  const [mode, setMode] = useState<"restart" | "reset" | "full">("restart");
  const opts: { k: "restart" | "reset" | "full"; title: string; desc: string }[] = [
    { k: "restart", title: "Restart", desc: t("members.restartDesc") },
    { k: "reset", title: "Reset Session & Restart", desc: t("members.resetDesc") },
    { k: "full", title: "Full Reset & Restart", desc: t("members.fullResetDesc") },
  ];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("members.restartTitle", { name })}</h3>
        <div className="restart-opts">
          {opts.map((o) => (
            <button key={o.k} type="button" className={"restart-opt" + (mode === o.k ? " on" : "")} onClick={() => setMode(o.k)}>
              <div className="ro-title">{o.title}</div>
              <div className="ro-desc">{o.desc}</div>
            </button>
          ))}
        </div>
        <div className="acts"><button className="cancel" onClick={onClose}>{t("members.cancel")}</button><button className="ok" onClick={() => onPick(mode)}>{t("members.restart")}</button></div>
      </div>
    </div>
  );
}
