import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Folder,
  Layers,
  MessageCircle,
  Pencil,
  Play,
  RotateCw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
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
import { useRuntimeDiscovery } from "../useRuntimeDiscovery.ts";
import { agentStatusLabel } from "../agentStatus.ts";
import { SearchField } from "../components/SearchField.tsx";
import { AgentDefaultResponseModeCard } from "./agent-response-mode/AgentDefaultResponseModeCard.tsx";
import { normalizeAgentResponseMode } from "./agent-response-mode/responseModeModel.ts";
import { AgentMemoryPanel } from "./agent-memory/AgentMemoryPanel.tsx";
import { AgentModelBindingEditor } from "./model-settings/AgentModelBindingEditor.tsx";
import { AgentActivityTimeline } from "../features/trajectory/AgentActivityTimeline.tsx";
import { Button } from "../components/ui/button.tsx";
import { cn } from "../lib/utils.ts";
import type { TrajSource } from "../trajBuffer.ts";

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
            <Avatar seed={a.name} url={avFor(a.avatarUrl)} size={20} /><span className="grow">{a.displayName || a.name}</span><span className={"dot " + statusOf(a)} role="img" aria-label={t("members.statusLabel", { status: agentStatusLabel(t, statusOf(a)) })} title={agentStatusLabel(t, statusOf(a))} />
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map((a) => {
                const to = workspaceLocationForModule(location.pathname, location.search, { moduleId: "agents", agent: a.id });
                const state = statusOf(a);
                return (
                  <div className="card card-link p-4 rounded-xl border border-border/60 bg-card hover:border-border hover:shadow-xs transition-all cursor-pointer" key={a.id} role="button" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => goKey(e, to)}>
                    <div className="flex items-center gap-2.5 mb-2">
                      <Avatar seed={a.name} url={avFor(a.avatarUrl)} size={28} />
                      <div className="min-w-0 grow">
                        <h3 className="text-sm font-semibold text-foreground truncate">{a.displayName || a.name}</h3>
                        <div className="text-xs text-muted-foreground">@{a.name}</div>
                      </div>
                      <span className={"dot " + state} />
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[32px]">{a.description || t("members.generalAgent")}</div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40 text-muted-foreground">
                      <span>{a.runtime} · {a.model || t("members.useLocalDefault")}</span>
                      <span className="font-medium text-foreground/80">{agentStatusLabel(t, state)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
    <div className="agent-acts flex items-center gap-1.5 flex-wrap">
      <Button variant="outline" size="sm" onClick={onMessage ?? msgAgent} className="gap-1.5 h-7 text-xs">
        <MessageCircle className="size-3.5 text-primary" /> {t("members.dm")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => ctl(a.status === "active" ? "stop" : "start")}
        className="gap-1.5 h-7 text-xs"
      >
        {a.status === "active" ? (
          <>
            <Square className="size-3.5 text-amber-500" /> {t("members.stop")}
          </>
        ) : (
          <>
            <Play className="size-3.5 text-green-500" /> {t("members.start")}
          </>
        )}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setShowRestart(true)} className="gap-1.5 h-7 text-xs">
        <RotateCw className="size-3.5 text-muted-foreground" /> {t("members.restart")}
      </Button>
      <Button variant="ghost" size="sm" onClick={del} className="gap-1.5 h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Trash2 className="size-3.5" /> {t("members.delete")}
      </Button>
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
      ) : (
        <div className="head head-agent flex items-center justify-between gap-4 flex-wrap pb-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <AvatarPicker name={a.name} url={signedAvatar} size={48} editable busy={avBusy} onPickSeed={onPickSeed} onPickFile={onPickAvatar} />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground tracking-tight flex items-center gap-2 truncate">
                {a.displayName || a.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span>@{a.name}</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-medium text-[11px]">
                  <span className={"dot " + live} />
                  {agentStatusLabel(t, live)}
                </span>
                {avErr && <span className="text-destructive font-medium ml-1">{avErr}</span>}
              </div>
            </div>
          </div>
          {acts}
        </div>
      )}
      <div className="border-b border-border/40 px-6 py-2 bg-transparent">
        <div className="inline-flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {([
            ["profile", t("members.tabProfile")],
            ["permissions", t("members.tabPermissions")],
            ["dms", t("members.tabDms")],
            ["reminders", t("members.tabReminders")],
            ["workspace", t("members.tabMemory")],
            ["integrations", t("members.tabIntegrations")],
            ["activity", t("members.tabActivity")],
          ] as [string, string][]).map(([k, label]) => {
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer whitespace-nowrap select-none border-0 outline-none",
                  active
                    ? "bg-foreground text-background font-semibold shadow-xs"
                    : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70"
                )}
                onClick={() => setSp((prev) => { const n = new URLSearchParams(prev); n.set("agentTab", k); return n; })}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "workspace" ? <AgentMemoryPanel agentId={id} />
        : tab === "activity" ? <ActivityTab activity={live} id={id} name={a.name} />
        : tab === "permissions" ? <PermissionsTab id={id} />
        : tab === "integrations" ? <AppsTab id={id} />
        : tab === "dms" ? <DmsTab id={id} name={a.name} />
        : tab === "reminders" ? <RemindersTab id={id} name={a.name} />
        : (
          <div className="scroll space-y-3">
            <div className="card space-y-3.5">
              {a.description ? (
                <div className="text-xs text-foreground/90 leading-relaxed bg-muted/30 p-3 rounded-lg border border-border/40">
                  {a.description}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  {t("members.generalAgent")}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-primary" /> {t("common.runtime")}
                  </span>
                  <span className="text-xs font-semibold text-foreground uppercase">{a.runtime}</span>
                </div>

                <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-primary" /> {t("common.model")}
                  </span>
                  <span className="text-xs font-medium text-foreground truncate" title={a.model || t("members.useLocalDefault")}>
                    {a.model || t("members.useLocalDefault")}
                  </span>
                </div>

                <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Activity className="size-3.5 text-primary" /> {t("common.status")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={"dot " + live} />
                    <span className="text-xs font-medium text-foreground">{agentStatusLabel(t, live)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" /> {t("common.session")}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">{a.sessionId || "(none)"}</span>
                </div>

                <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50 sm:col-span-2">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Folder className="size-3.5 text-primary" /> {t("common.memory")}
                  </span>
                  <AgentMemoryRoot id={a.id} />
                </div>

                {a.createdAt && (
                  <div className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/50 bg-background/50">
                    <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                      <Clock className="size-3.5 text-primary" /> {t("common.created")}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-1">
                <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5 h-7 text-xs">
                  <Pencil className="size-3.5" /> {t("members.editProfile")}
                </Button>
              </div>
            </div>

            <AgentModelBindingEditor agent={a} api={api} onSaved={refetch} />
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
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  useEffect(() => { (async () => { try { setD(await api("GET", `/api/agents/${id}/skills`)); } catch { setD({ global: [], workspace: [] }); } })(); }, [id]);
  if (!d) return null;
  const all = [...(d.workspace || []).map((s) => ({ ...s, scope: t("members.scopeWorkspace") })), ...(d.global || []).map((s) => ({ ...s, scope: t("members.scopeGlobal") }))];

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> {t("common.skills")}
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{all.length}</span>
      </div>
      {all.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">{t("members.skillsEmpty")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {all.map((s, i) => {
            const isLong = (s.description?.length || 0) > 100;
            const isExp = expanded[i];
            return (
              <div key={i} className="p-3 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-xs text-foreground">{s.displayName || s.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{s.scope}</span>
                    {s.userInvocable && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t("members.skillInvocable")}</span>
                    )}
                  </div>
                </div>
                {s.description ? (
                  <div>
                    <p className={cn("text-xs text-muted-foreground leading-relaxed", !isExp && "line-clamp-2")}>
                      {s.description}
                    </p>
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(i)}
                        className="mt-1 text-[11px] text-primary/80 hover:text-primary font-medium flex items-center gap-0.5"
                      >
                        {isExp ? <>收起 <ChevronUp className="size-3" /></> : <>展开全部 <ChevronDown className="size-3" /></>}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground/60 italic">{t("members.noDescription")}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
    <div className="scroll space-y-3">
      <div className="perm-head flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-card">
        <span className="text-xs text-muted-foreground">{data.mode === "custom" ? t("members.permCustom") : t("members.permDefault")} · rev {data.revision}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => save((data.catalog || []).map((s: any) => s.key))} className="h-7 text-xs">{t("members.grantAll")}</Button>
          <Button size="sm" onClick={() => save([...granted])} className="h-7 text-xs">{t("members.save")}</Button>
          {saved && <span className="saved text-xs text-green-500 font-medium">{t("members.savedConfirm")}</span>}
        </div>
      </div>
      {Object.entries(groups).map(([g, list]) => (
        <div key={g} className="perm-group card space-y-2">
          <div className="text-xs font-semibold text-foreground uppercase tracking-wider">{t(`members.permissionGroups.${g}`, { defaultValue: g })}</div>
          <div className="space-y-1.5 pt-1">
            {list.map((s: any) => (
              <label key={s.key} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/30 cursor-pointer transition-colors">
                <input type="checkbox" className="mt-1 rounded accent-primary" checked={granted.has(s.key)} onChange={() => toggle(s.key)} />
                <span className="grow min-w-0">
                  <span className="text-xs font-medium text-foreground">{t(`members.permissions.${s.key.replace(":", "_")}.label`, { defaultValue: s.label })}</span>{" "}
                  <code className="text-[11px] font-mono text-muted-foreground px-1 py-0.2 rounded bg-muted">{s.key}</code>
                  <div className="text-xs text-muted-foreground mt-0.5">{t(`members.permissions.${s.key.replace(":", "_")}.description`, { defaultValue: s.description })}</div>
                </span>
              </label>
            ))}
          </div>
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
function ActivityTab({ activity, id, name }: { activity?: string; id: string; name: string }) {
  const { slug } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const openSource = (source: TrajSource) => {
    if (source.unavailable) return;
    const target = source.kind === "thread" && source.conversationId && source.parentMessageId
      ? `/s/${slug}/channel/${source.conversationId}?thread=${source.parentMessageId}`
      : source.channelId
        ? `/s/${slug}/channel/${source.channelId}`
        : null;
    if (!target) return;
    const discussionSearch = workspaceSearchForShellState(location.search, {
      activeModule: "agents",
      chatVisible: true,
    });
    nav(mergeWorkspaceSearch(target, discussionSearch));
  };
  return (
    <AgentActivityTimeline
      activity={activity}
      id={id}
      name={name}
      onOpenSource={openSource}
    />
  );
}

// Agent Memory file tree. The legacy workspace-files route names remain compatible with existing clients.
// .md files: Preview (rendered markdown, default) / Raw (monospace source) toggle. Other files: monospace source only.
function AgentMemoryRoot({ id }: { id: string }) {
  const { api } = useStore();
  const [root, setRoot] = useState("...");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setRoot("...");
    void api("GET", `/api/agents/${id}/workspace-files`).then((result) => {
      if (active && result?.root) setRoot(result.root);
    });
    return () => { active = false; };
  }, [id]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (root && root !== "...") {
      void navigator.clipboard.writeText(root);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const displayPath = root.length > 40 ? "..." + root.slice(-36) : root;

  return (
    <div className="flex items-center gap-1.5 max-w-full">
      <span className="font-mono text-[11px] text-muted-foreground truncate bg-muted/40 px-2 py-0.5 rounded border border-border/40" title={root}>
        {displayPath}
      </span>
      {root !== "..." && (
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? "已复制" : "复制完整路径"}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
        >
          {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
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
  const [bindingMode, setBindingMode] = useState<"runtime_default" | "pinned">("runtime_default");
  const [modelConfigurations, setModelConfigurations] = useState<any[]>([]);
  const [modelConfigurationId, setModelConfigurationId] = useState("");
  const [runtimeDefaultUnset, setRuntimeDefaultUnset] = useState(false);
  const {
    runtime, setRuntime, runtimeOptions, runtimesLoading, runtimeError, runtimeInstalled,
  } = useRuntimeDiscovery(api, false);
  useEffect(() => {
    void api("GET", "/api/settings/model-configurations")
      .then((result: any) => setModelConfigurations(
        (result.items ?? []).filter((item: any) => item.status === "active"),
      ))
      .catch(() => setModelConfigurations([]));
  }, [api]);
  useEffect(() => {
    if (!runtime) { setRuntimeDefaultUnset(false); return; }
    let cancelled = false;
    void api("GET", `/api/settings/runtimes/${encodeURIComponent(runtime)}`)
      .then((result: any) => {
        if (!cancelled) setRuntimeDefaultUnset(result?.defaultBinding?.mode === "unset");
      })
      .catch(() => { if (!cancelled) setRuntimeDefaultUnset(false); });
    return () => { cancelled = true; };
  }, [api, runtime]);
  useEffect(() => {
    const saved = sessionStorage.getItem("kith-agent-create-draft");
    if (!saved) return;
    try {
      const value = JSON.parse(saved);
      if (!prefill?.name && typeof value.name === "string") setName(value.name);
      if (!prefill?.description && typeof value.description === "string") setDesc(value.description);
      if (value.bindingMode === "runtime_default" || value.bindingMode === "pinned") setBindingMode(value.bindingMode);
      if (typeof value.modelConfigurationId === "string") setModelConfigurationId(value.modelConfigurationId);
    } catch { /* ignore stale draft */ }
  }, []);
  useEffect(() => {
    sessionStorage.setItem("kith-agent-create-draft", JSON.stringify({
      name, description: desc, runtime, bindingMode, modelConfigurationId,
    }));
  }, [bindingMode, desc, modelConfigurationId, name, runtime]);
  const create = async () => {
    const nm = name.trim();
    if (!nm) { setErr(t("members.nameRequired")); return; }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(nm) || nm.length > 64) { setErr(t("members.nameInvalid")); return; } // @mention handle must be token-safe; keep regex + length 64 in sync with core.ts AGENT_NAME_RE / MAX_AGENT_NAME
    if (!runtimeInstalled) { setErr(t("members.runtimeUnavailable")); return; }
    if (bindingMode === "pinned" && !modelConfigurationId) { setErr("请选择 Kith 模型配置"); return; }
    if (bindingMode === "runtime_default" && runtimeDefaultUnset) { setErr(t("members.runtimeDefaultUnset")); return; }
    setBusy(true); setErr("");
    try {
      const selectedConfiguration = modelConfigurations.find((item) => item.id === modelConfigurationId);
      const r = await api("POST", "/api/agents", { name: nm,
        description: desc.trim() || null, runtime,
        model: null,
        modelBinding: bindingMode === "pinned"
          ? { mode: "pinned", modelConfigurationId, modelConfigurationRevision: selectedConfiguration?.currentRevision ?? 1 }
          : { mode: "runtime_default" },
        reasoning: null, fastMode: fast,
      });
      if (r?.error) {
        setErr(r.code === "model_binding_setup_required" ? t("members.modelBindingSetupRequired") : r.error);
        return;
      }
      await reload();
      if (r?.id) { if (r.started === false) toast.info(t("members.agentCreatedOffline")); onCreated?.({ id: r.id, name: r.name ?? nm }); }
      sessionStorage.removeItem("kith-agent-create-draft");
      onClose();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  };
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
        <label>模型绑定</label>
        <Select ariaLabel="模型绑定方式" value={bindingMode} onChange={(value) => setBindingMode(value as "runtime_default" | "pinned")}
          options={[
            { value: "runtime_default", label: "跟随运行器默认配置" },
            { value: "pinned", label: "固定 Kith 模型配置" },
          ]} />
        {bindingMode === "pinned" ? <>
          <label>Kith 模型配置</label>
          <Select ariaLabel="Kith 模型配置" value={modelConfigurationId} onChange={setModelConfigurationId}
            options={modelConfigurations.filter((item) => item.compatibility?.[runtime]?.supported)
              .map((item) => ({ value: item.id, label: `${item.displayName} · ${item.provider.displayName}` }))}
            placeholder="请先在“设置 → 模型与供应商”创建兼容配置" />
        </> : runtimeDefaultUnset ? <div className="form-err">{t("members.runtimeDefaultUnset")}</div> : null}
        <label className="ck-row"><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /><span>{t("members.fastMode")}</span></label>
        {err && <div className="form-err">{err}</div>}
        <div className="acts"><button className="cancel" onClick={onClose}>{t("members.cancel")}</button><button className="ok" onClick={create} disabled={busy || runtimesLoading || !runtimeInstalled || (bindingMode === "pinned" && !modelConfigurationId) || (bindingMode === "runtime_default" && runtimeDefaultUnset)}>{busy ? t("members.creating") : t("members.create")}</button></div>
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
