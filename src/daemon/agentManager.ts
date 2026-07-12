// Manages local agents: spawns processes via the runtime interface, bridges events to the server, and handles delivery/sleep. Runtime protocol details live in each runtime file.
import { mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import os from "node:os";
import { buildSystemPrompt, inboxNotice } from "./prompt.js";
import { selectAgentInitialTurn } from "./agentLifecycle.js";
import type { AgentStartReason } from "../local-runtime/agentStart.js";
import { seedMemory, applyProfileToMemory } from "./memory.js";
import { ensureSharedMemoryLayers, resolveMemoryLayerPaths } from "./memoryLayers.js";
import { ensureKithSpaceBin } from "./kithSpaceBin.js";
import { getRuntime } from "./runtimes.js";
import type { Runtime, RuntimeSession, RuntimeCallbacks } from "./runtime.js";
import { createLogger } from "../log.js";
import { buildAgentProcessEnv } from "./agentProcessEnv.js";
import { resolveAgentWorkspacePaths, type AgentWorkspaceRef } from "./agentWorkspacePaths.js";
import { runtimeDir } from "../paths.js";

const IDLE_MS = Number(process.env.KITH_SPACE_IDLE_MS ?? 10 * 60 * 1000); // how long before idle sleep (kills process to save memory; next wake uses --resume)
const DELIVER_DEBOUNCE_MS = Number(process.env.KITH_SPACE_DELIVER_DEBOUNCE_MS ?? 3000); // batching window for deliveries while agent is busy (saves tokens, reduces interruptions)
const ONE_SHOT_DELIVER_DEBOUNCE_MS = Number(process.env.KITH_SPACE_ONE_SHOT_DELIVER_DEBOUNCE_MS ?? process.env.KITH_SPACE_HERMES_DELIVER_DEBOUNCE_MS ?? 500); // One-shot runtimes need a short fixed wait when there is only one live notice.
const PENDING_DELIVER_TTL_MS = Number(process.env.KITH_SPACE_PENDING_DELIVER_TTL_MS ?? 15_000); // start+deliver can arrive back-to-back; keep deliver briefly while start prepares workspace
const LEGACY_INSTRUCTION_FILE_RUNTIMES = new Set(["copilot", "kimi", "cursor"]);

export interface AgentConfig extends AgentWorkspaceRef {
  name: string; displayName: string; description?: string | null;
  model?: string; runtime?: string; runtimeConfig?: Record<string, unknown> | null; sessionId?: string; introduced?: boolean; introductionToken?: string;
  serverUrl: string; agentToken?: string; // per-agent token (slice10); re-sent start for a running agent may omit it (daemon ignores)
}
interface DeliverBuf { count: number; from: string; target: string; targetName: string; firstShort: string; latestShort: string; isTask: boolean; mentioned: boolean; targets: Set<string>; timer: ReturnType<typeof setTimeout>; streamId?: string; }
export interface DeliverMeta { targetName?: string; msgShort?: string; isTask?: boolean; streamId?: string; }
interface Running { session: RuntimeSession; config: AgentConfig; sessionId: string | null; exited: Promise<void>; markExited: () => void; idleTimer?: ReturnType<typeof setTimeout>; deliverBuf?: DeliverBuf; }
interface PendingDeliver { from: string; target: string; mentioned: boolean; meta: DeliverMeta; }
interface PendingDeliverQueue { items: PendingDeliver[]; timer: ReturnType<typeof setTimeout>; }
interface ActiveReplyPreview { channelId: string; streamId: string; name: string; }
interface AgentManagerOptions {
  runtimeStateRoot?: string;
  binDir?: string;
  removePath?: (target: string) => Promise<void>;
  deliverDebounceMs?: number;
  oneShotDeliverDebounceMs?: number;
  pendingDeliverTtlMs?: number;
  runtimeResolver?: (name: string) => Runtime | null;
}

export class AgentManager {
  private agents = new Map<string, Running>();
  private starting = new Map<string, Promise<void>>();
  private resetting = new Map<string, Promise<void>>();
  private pendingDelivers = new Map<string, PendingDeliverQueue>();
  private activeReplyPreviews = new Map<string, ActiveReplyPreview>();
  private replySeq = 0;
  private binDir: string;
  private runtimeStateRoot: string;
  private removePath: (target: string) => Promise<void>;
  private deliverDebounceMs: number;
  private oneShotDeliverDebounceMs: number;
  private pendingDeliverTtlMs: number;
  private runtimeResolver: (name: string) => Runtime | null;
  private log = createLogger("daemon:agents");
  constructor(private send: (msg: unknown) => void, opts: AgentManagerOptions = {}) {
    this.binDir = opts.binDir ?? ensureKithSpaceBin();
    this.runtimeStateRoot = opts.runtimeStateRoot ?? runtimeDir();
    this.removePath = opts.removePath ?? ((target) => rm(target, { recursive: true, force: true }));
    this.deliverDebounceMs = opts.deliverDebounceMs ?? DELIVER_DEBOUNCE_MS;
    this.oneShotDeliverDebounceMs = opts.oneShotDeliverDebounceMs ?? ONE_SHOT_DELIVER_DEBOUNCE_MS;
    this.pendingDeliverTtlMs = opts.pendingDeliverTtlMs ?? PENDING_DELIVER_TTL_MS;
    this.runtimeResolver = opts.runtimeResolver ?? getRuntime;
  }

  running(): string[] { return [...this.agents.keys()]; }
  stopAll(): void { for (const id of [...this.agents.keys()]) this.stop(id); }
  async stopAllAndWait(timeoutMs = 4_000): Promise<void> {
    const running = [...this.agents.values()];
    let firstError: unknown;
    for (const id of [...this.agents.keys()]) {
      try { this.stop(id); } catch (error) { firstError ??= error; }
    }
    if (firstError) throw firstError;
    if (running.length === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(running.map(({ exited }) => exited)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`agent runtimes did not exit within ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  // Tear down process: clear timers + remove from map first (critical: deletion before session.stop() lets the onExit has() guard recognize this as an intentional stop, suppressing unexpected sleeping status) + stop runtime. Returns whether the agent was found.
  private teardown(agentId: string): boolean { this.clearPendingDeliver(agentId); this.finishReplyPreview(agentId); const r = this.agents.get(agentId); if (!r) return false; if (r.idleTimer) clearTimeout(r.idleTimer); if (r.deliverBuf) clearTimeout(r.deliverBuf.timer); this.agents.delete(agentId); r.session.stop(); return true; }
  // User-initiated stop: emits inactive/offline
  stop(agentId: string): void { if (!this.teardown(agentId)) return; this.send({ type: "agent:status", agentId, status: "inactive" }); this.send({ type: "agent:activity", agentId, activity: "offline", detail: "" }); }
  // Idle sleep: emits sleeping/sleeping (activity also set to sleeping so the frontend activity+status dual mapping stays consistent; session is preserved for --resume on next wake)
  sleep(agentId: string): void { if (!this.teardown(agentId)) return; this.log.info("sleep", { agentId }); this.send({ type: "agent:status", agentId, status: "sleeping" }); this.send({ type: "agent:activity", agentId, activity: "sleeping", detail: "" }); }
  /** Reset runtime-local state; an explicit full reset also clears only this agent's Space-local memory. */
  async reset(ref: AgentWorkspaceRef, options: { clearAgentMemory?: boolean } = {}): Promise<void> {
    const previous = this.resetting.get(ref.agentId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.resetNow(ref, options)).finally(() => {
      if (this.resetting.get(ref.agentId) === pending) this.resetting.delete(ref.agentId);
    });
    this.resetting.set(ref.agentId, pending);
    return pending;
  }
  private async resetNow(ref: AgentWorkspaceRef, options: { clearAgentMemory?: boolean }): Promise<void> {
    const starting = this.starting.get(ref.agentId);
    if (starting) await starting.catch(() => {});
    this.teardown(ref.agentId); // skip stop() to avoid double inactive emit; reset sends its own inactive/offline+detail=reset below
    this.send({ type: "agent:session", agentId: ref.agentId, sessionId: null });
    const paths = resolveAgentWorkspacePaths(ref, this.runtimeStateRoot);
    try { await this.removePath(paths.runtimeStateDir); this.log.info("runtime state cleared", { agentId: ref.agentId }); }
    catch (e) { this.log.warn("runtime state clear failed", { agentId: ref.agentId, detail: String(e) }); }
    if (options.clearAgentMemory) {
      try { await this.removePath(paths.agentMemoryDir); this.log.info("agent memory cleared", { agentId: ref.agentId }); }
      catch (e) { this.log.warn("agent memory clear failed", { agentId: ref.agentId, detail: String(e) }); }
    }
    this.send({ type: "agent:status", agentId: ref.agentId, status: "inactive" });
    this.send({ type: "agent:activity", agentId: ref.agentId, activity: "offline", detail: "reset" });
    this.log.info("agent reset", { agentId: ref.agentId, clearAgentMemory: !!options.clearAgentMemory });
  }
  /** Profile changed on the server (displayName/description) — surgically sync the workspace MEMORY.md
   *  title + `## Role`, preserving the agent's own sections. No-op if the workspace/file doesn't exist
   *  yet (a not-yet-started agent gets fresh values from the DB when start() seeds it). */
  async syncProfile(ref: AgentWorkspaceRef, displayName: string, description?: string | null): Promise<void> {
    const agentId = ref.agentId;
    const paths = resolveAgentWorkspacePaths(ref, this.runtimeStateRoot);
    const mem = resolveMemoryLayerPaths(paths.workspaceRoot, paths.agentMemoryDir).agent.indexFile;
    let content: string;
    try { content = await readFile(mem, "utf8"); }
    catch { this.log.debug("syncProfile: no MEMORY.md yet", { agentId }); return; }
    const next = applyProfileToMemory(content, displayName || agentId, description);
    if (next !== content) {
      try { await writeFile(mem, next); this.log.info("profile synced to MEMORY.md", { agentId }); }
      catch (e) { this.log.warn("syncProfile write failed", { agentId, detail: String(e) }); return; }
    }
    // Keep a running agent's cached config fresh so a later --resume uses the new values.
    const r = this.agents.get(agentId);
    if (r) { r.config.displayName = displayName; r.config.description = description ?? null; }
  }
  private resetIdle(agentId: string): void {
    const r = this.agents.get(agentId); if (!r) return;
    if (r.idleTimer) clearTimeout(r.idleTimer);
    r.idleTimer = setTimeout(() => { this.log.info("idle sleep", { agentId, idleMs: IDLE_MS }); this.sleep(agentId); }, IDLE_MS);
  }

  private startReplyPreview(agentId: string, r: Running, channelId: string, streamId?: string): void {
    const existing = this.activeReplyPreviews.get(agentId);
    if (existing?.channelId === channelId && (!streamId || existing.streamId === streamId)) return;
    this.finishReplyPreview(agentId);
    const preview: ActiveReplyPreview = {
      channelId,
      streamId: streamId ?? `${Date.now()}-${++this.replySeq}`,
      name: r.config.displayName || r.config.name || agentId,
    };
    this.activeReplyPreviews.set(agentId, preview);
    this.send({ type: "agent:reply", agentId, channelId: preview.channelId, streamId: preview.streamId, name: preview.name, op: "start" });
  }

  private sendReplyPreviewDelta(agentId: string, entries: { kind?: string; text?: string }[]): void {
    const preview = this.activeReplyPreviews.get(agentId);
    if (!preview) return;
    for (const e of entries) {
      if (e.kind !== "text" || !e.text) continue;
      this.send({ type: "agent:reply", agentId, channelId: preview.channelId, streamId: preview.streamId, name: preview.name, op: "delta", text: e.text });
    }
  }

  private finishReplyPreview(agentId: string, op: "done" | "error" = "done"): void {
    const preview = this.activeReplyPreviews.get(agentId);
    if (!preview) return;
    this.activeReplyPreviews.delete(agentId);
    this.send({ type: "agent:reply", agentId, channelId: preview.channelId, streamId: preview.streamId, name: preview.name, op });
  }

  async start(agentId: string, config: AgentConfig, reason: AgentStartReason = "manual"): Promise<void> {
    const resetting = this.resetting.get(agentId);
    if (resetting) await resetting;
    if (this.agents.has(agentId)) return;
    const existing = this.starting.get(agentId);
    if (existing) return existing;
    const pending = this.startNow(agentId, config, reason).finally(() => this.starting.delete(agentId));
    this.starting.set(agentId, pending);
    return pending;
  }

  private async startNow(agentId: string, config: AgentConfig, reason: AgentStartReason): Promise<void> {
    if (this.agents.has(agentId)) return;
    const runtime = this.runtimeResolver(config.runtime ?? "claude");
    if (!runtime) {
      this.log.error("no runtime", { runtime: config.runtime });
      this.send({ type: "agent:activity", agentId, activity: "offline", detail: `no runtime: ${config.runtime}` });
      return;
    }
    if (runtime.experimental) this.log.warn("experimental runtime", { runtime: runtime.name });

    const paths = resolveAgentWorkspacePaths(config, this.runtimeStateRoot);
    const memory = resolveMemoryLayerPaths(paths.workspaceRoot, paths.agentMemoryDir);
    await Promise.all([
      mkdir(memory.agent.notesDir, { recursive: true }),
      mkdir(paths.runtimeStateDir, { recursive: true }),
    ]);
    await ensureSharedMemoryLayers(memory);
    const mem = memory.agent.indexFile;
    try { await access(mem); } catch {
      await writeFile(mem, seedMemory(config.displayName || config.name, config.description));
    }

    const systemPrompt = buildSystemPrompt({
      name: config.name, displayName: config.displayName, description: config.description,
      agentId, spaceId: config.spaceId, hostname: os.hostname(), os: `${os.platform()} ${os.arch()}`, workspace: paths.workspaceRoot, memory,
    });
    const env = buildAgentProcessEnv({
      binDir: this.binDir,
      serverUrl: config.serverUrl,
      agentId,
      agentToken: config.agentToken ?? "",
    });
    const pendingDeliverItems = this.pendingDelivers.get(agentId)?.items ?? [];
    const pendingDeliveryCount = pendingDeliverItems.length;
    const initialTurn = selectAgentInitialTurn({
      introduced: config.introduced,
      reason,
      hasPendingDelivery: pendingDeliveryCount > 0,
    });
    if (initialTurn.kind === "introduction" && config.introductionToken) {
      env.KITH_SPACE_INTRODUCTION_TOKEN = config.introductionToken;
    }

    let markExited = () => {};
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const running: Running = { session: undefined as unknown as RuntimeSession, config, sessionId: config.sessionId ?? null, exited, markExited };
    const cb: RuntimeCallbacks = {
      onSession: (sid) => { running.sessionId = sid; this.send({ type: "agent:session", agentId, sessionId: sid }); },
      onActivity: (activity, detail) => {
        this.resetIdle(agentId);
        this.send({ type: "agent:activity", agentId, activity, detail: detail ?? "" });
        if (activity === "online" || activity === "sleeping" || activity === "offline" || activity === "error") this.finishReplyPreview(agentId, activity === "error" ? "error" : "done");
      },
      onTrajectory: (entries) => { this.send({ type: "agent:trajectory", agentId, entries }); this.sendReplyPreviewDelta(agentId, entries); },
      onExit: (code) => {
        running.markExited();
        this.log.info("agent exited", { agentId, code });
        if (!this.agents.has(agentId)) return; // intentional stop/sleep/reset already called teardown (removed from map) — they sent their own status, don't overwrite
        this.agents.delete(agentId);
        // Process died on its own (not intentionally stopped): keep status=sleeping (session preserved, @ can --resume to recover);
        // Non-zero exit code (crash/signal kill) → activity=error to surface the failure; clean exit → sleeping.
        const crashed = code !== 0;
        this.finishReplyPreview(agentId, crashed ? "error" : "done");
        this.send({ type: "agent:status", agentId, status: "sleeping" });
        this.send({ type: "agent:activity", agentId, activity: crashed ? "error" : "sleeping", detail: crashed ? `crashed (exit ${code ?? "signal"})` : "" });
      },
      log: this.log,
    };

    // No await between set and runtime.start (single-threaded event loop), so deliver cannot interleave and read an empty session.
    // A delivery that arrived during workspace preparation is already persisted in the inbox. Consume
    // its queued notice here because the initial wake prompt performs the same check in a single turn.
    const consumePendingWake = initialTurn.kind === "wake" && pendingDeliveryCount > 0;
    // Copilot/Kimi/Cursor still require a cwd-level AGENTS.md for their standing prompt. Keep those
    // experimental adapters in host runtime state until they gain a non-polluting prompt channel.
    const runtimeCwd = LEGACY_INSTRUCTION_FILE_RUNTIMES.has(runtime.name) ? paths.runtimeStateDir : paths.workspaceRoot;
    this.agents.set(agentId, running);
    if (consumePendingWake) {
      const latest = pendingDeliverItems[pendingDeliverItems.length - 1];
      if (latest) this.startReplyPreview(agentId, running, latest.target, latest.meta.streamId);
    }
    running.session = runtime.start({
      cwd: runtimeCwd, runtimeStateDir: paths.runtimeStateDir, model: config.model, runtimeConfig: config.runtimeConfig, sessionId: config.sessionId, systemPrompt, env,
      initialPrompt: initialTurn.prompt,
    }, cb);

    this.send({ type: "agent:status", agentId, status: "active" });
    this.send({ type: "agent:activity", agentId, activity: "working", detail: "starting" });
    this.log.info("agent started", { agentId, runtime: runtime.name, model: config.model ?? "(default)", resume: !!config.sessionId, experimental: runtime.experimental ?? false });
    this.resetIdle(agentId);
    if (consumePendingWake) {
      this.clearPendingDeliver(agentId);
      this.log.debug("pending deliver consumed by initial wake turn", { agentId, runtime: runtime.name, count: pendingDeliveryCount });
    } else {
      this.flushPendingDeliver(agentId);
    }
  }

  private queuePendingDeliver(agentId: string, item: PendingDeliver): void {
    let q = this.pendingDelivers.get(agentId);
    if (!q) {
      const timer = setTimeout(() => {
        this.pendingDelivers.delete(agentId);
        this.log.debug("pending deliver expired", { agentId });
      }, this.pendingDeliverTtlMs);
      q = { items: [], timer };
      this.pendingDelivers.set(agentId, q);
    }
    q.items.push(item);
    if (q.items.length > 10) q.items.shift();
    this.log.debug("deliver queued pending start", { agentId, count: q.items.length });
  }

  private clearPendingDeliver(agentId: string): void {
    const q = this.pendingDelivers.get(agentId);
    if (!q) return;
    clearTimeout(q.timer);
    this.pendingDelivers.delete(agentId);
  }

  private flushPendingDeliver(agentId: string): void {
    const q = this.pendingDelivers.get(agentId);
    if (!q) return;
    this.clearPendingDeliver(agentId);
    this.log.debug("pending deliver -> agent", { agentId, count: q.items.length });
    for (const item of q.items) this.deliver(agentId, item.from, item.target, item.mentioned, item.meta);
  }

  private debounceMsFor(r: Running): number {
    const runtime = this.runtimeResolver(r.config.runtime ?? "claude");
    return runtime?.oneShotWake ? this.oneShotDeliverDebounceMs : this.deliverDebounceMs;
  }

  /** server agent:deliver — wake a running agent with new messages; if start is still preparing the workspace, briefly queue and flush once the runtime exists. */
  deliver(agentId: string, from: string, target: string, mentioned = false, meta: DeliverMeta = {}): void {
    const r = this.agents.get(agentId);
    if (!r) { this.queuePendingDeliver(agentId, { from, target, mentioned, meta }); return; }
    // Delivery batching while busy: multiple messages within 3 s are coalesced into one inbox notice, reducing interruptions and token usage.
    const tname = meta.targetName ?? target;
    const short = meta.msgShort ?? "";
    const b = r.deliverBuf;
    if (b) { // accumulate: count++, update latest, keep first unchanged, union target set
      clearTimeout(b.timer); b.count++; b.from = from; b.target = target; b.targetName = tname; b.latestShort = short;
      b.isTask = b.isTask || !!meta.isTask; b.mentioned = b.mentioned || mentioned; b.targets.add(tname); b.streamId = meta.streamId ?? b.streamId;
      this.startReplyPreview(agentId, r, target, b.streamId);
    }
    const buf: DeliverBuf = b ?? { count: 1, from, target, targetName: tname, firstShort: short, latestShort: short, isTask: !!meta.isTask, mentioned, targets: new Set([tname]), timer: undefined as any, streamId: meta.streamId };
    this.startReplyPreview(agentId, r, target, buf.streamId);
    buf.timer = setTimeout(() => {
      r.deliverBuf = undefined;
      const note = inboxNotice({ count: buf.count, from: buf.from, targetName: buf.targetName, firstShort: buf.firstShort, latestShort: buf.latestShort, isTask: buf.isTask, isDm: buf.targetName.startsWith("dm:"), changedTargets: buf.targets.size, mentioned: buf.mentioned });
      try { r.session.deliver(note); this.resetIdle(agentId); this.log.debug("inbox notice -> agent", { agentId, count: buf.count, mentioned: buf.mentioned }); }
      catch (e) { this.finishReplyPreview(agentId, "error"); this.log.warn("deliver failed", { agentId, detail: String(e) }); }
    }, this.debounceMsFor(r));
    r.deliverBuf = buf;
  }
}
