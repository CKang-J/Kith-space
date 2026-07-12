// OpenCode runtime: one-shot `opencode run --format json` per turn, chained by the session id
// OpenCode assigns (`ses_…`, captured from the event stream). Like copilot it is one-shot-per-turn
// (not a persistent process), so each deliver() spawns a fresh process that resumes via --session.
//
// Two load-bearing gotchas, both verified against opencode 1.15.5:
//  1. stdin MUST be "ignore" — with a piped/non-TTY stdout, `opencode run` BLOCKS reading stdin
//     forever (it never emits a single event). The daemon uses pipe stdio, so this would hang every
//     agent. We pass the message as argv and close stdin.
//  2. --auto is required for headless runs (otherwise it waits on approval),
//     and NODE_OPTIONS is stripped from the child env (a proxy flag like `--use-env-proxy` makes some
//     bundled CLIs refuse to start). The system prompt is injected into a child-only internal agent
//     through OPENCODE_CONFIG_CONTENT; user/project AGENTS.md files are never modified.
import type { ChildProcess } from "node:child_process";
import type { Runtime, StartOpts, RuntimeCallbacks, RuntimeSession, TrajectoryEntry } from "./runtime.js";
import { spawnRuntimeProcess } from "./runtimeProcess.js";
import { validateRuntimeModel } from "../local-runtime/runtimeCatalog.js";

const MAX = 2000;
const clip = (s: unknown) => String(s ?? "").slice(0, MAX);
export const KITH_OPENCODE_AGENT = "__kith_runtime__";

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Merge Kith's transparent execution agent into OpenCode's child-only inline config. */
export function buildOpencodeConfigContent(systemPrompt: string, existing?: string): string {
  const base = existing?.trim() ? record(JSON.parse(existing)) : {};
  const agents = record(base.agent);
  return JSON.stringify({
    ...base,
    agent: {
      ...agents,
      [KITH_OPENCODE_AGENT]: {
        description: "Internal Kith-space runtime execution agent",
        mode: "primary",
        prompt: systemPrompt,
      },
    },
  });
}

function variant(rc: Record<string, unknown> | null | undefined): string | null {
  // OpenCode exposes provider-specific reasoning effort as a model "variant" (e.g. high|max|minimal).
  const e = rc?.reasoningEffort;
  return typeof e === "string" && e ? e : null;
}

function summarizeToolInput(input: any): string {
  if (!input || typeof input !== "object") return clip(input).slice(0, 160);
  const v = input.command ?? input.filePath ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? "";
  return clip(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 160);
}

// ── pure event mapping (unit-tested against real fixtures) ──
export interface OpencodeEmit {
  trajectory: TrajectoryEntry[];
  activity?: { activity: string; detail: string };
  sessionId?: string;
  error?: string;
}

// handleOpencodeEvent maps one parsed `opencode run --format json` event to kith-space callbacks.
// Event envelope (verified against 1.15.5): { type, timestamp, sessionID, part:{ type, ... } }.
export function handleOpencodeEvent(evt: any): OpencodeEmit {
  const out: OpencodeEmit = { trajectory: [] };
  if (typeof evt?.sessionID === "string" && evt.sessionID) out.sessionId = evt.sessionID;
  const part = evt?.part ?? {};
  switch (evt?.type) {
    case "step_start":
      out.activity = { activity: "working", detail: "turn" };
      break;
    case "text":
      if (part.text) out.trajectory.push({ kind: "text", text: clip(part.text) });
      break;
    case "reasoning": // thinking models emit this; content lives in part.text
      if (part.text) out.trajectory.push({ kind: "thinking", text: clip(part.text) });
      break;
    case "tool_use": {
      const name = String(part.tool ?? "tool");
      const input = part.state?.input ?? part.input;
      out.trajectory.push({ kind: "tool", toolName: name, toolInput: summarizeToolInput(input) });
      break;
    }
    case "error":
      // opencode exits 0 on model errors; the failure is a top-level JSON event (not a non-zero exit)
      out.error = String(evt.error?.data?.message ?? evt.error?.name ?? "opencode error");
      break;
    // step_finish / other lifecycle events: process exit is the authoritative turn-done signal.
  }
  return out;
}

function buildArgs(message: string, opts: StartOpts, sessionId: string | null): string[] {
  const args = ["run", "--format", "json", "--auto", "--agent", KITH_OPENCODE_AGENT, "--dir", opts.cwd];
  const model = opts.model && opts.model !== "default" ? opts.model : "";
  if (model) args.push("--model", model);
  const v = variant(opts.runtimeConfig);
  if (v) args.push("--variant", v);
  if (sessionId) args.push("--session", sessionId);
  args.push(message);
  return args;
}

// OpencodeRun owns the serial turn queue for one agent (mirrors codex/copilot's queue/pump), but each
// turn is a fresh one-shot `opencode run` process resumed by the captured session id.
class OpencodeRun {
  private queue: string[] = [];
  private turnBusy = false;
  private stopped = false;
  private proc: ChildProcess | null = null;
  private sessionId: string | null;
  private everSucceeded = false;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly opts: StartOpts, private readonly cb: RuntimeCallbacks) {
    this.sessionId = opts.sessionId ?? null; // resume an existing session, or null = let opencode create one
    // Strip NODE_OPTIONS (a proxy flag can make the bundled CLI refuse to start) and pin PWD — opencode
    // uses PWD (not just cwd) to anchor project discovery.
    this.env = { ...opts.env, PWD: opts.cwd };
    delete this.env.NODE_OPTIONS;
    try { this.env.OPENCODE_CONFIG_CONTENT = buildOpencodeConfigContent(opts.systemPrompt, this.env.OPENCODE_CONFIG_CONTENT); }
    catch (e) {
      cb.log.warn("opencode: invalid existing OPENCODE_CONFIG_CONTENT ignored", { detail: String(e) });
      this.env.OPENCODE_CONFIG_CONTENT = buildOpencodeConfigContent(opts.systemPrompt);
    }
    if (this.sessionId) cb.onSession(this.sessionId);
    this.enqueue(opts.initialPrompt);
  }

  enqueue(text: string): void { if (this.stopped) return; this.queue.push(text); this.pump(); }

  private pump(): void {
    if (this.stopped || this.turnBusy || this.queue.length === 0) return;
    this.runTurn(this.queue.shift()!);
  }

  private runTurn(message: string): void {
    this.turnBusy = true;
    this.cb.onActivity("working", "turn");
    const args = buildArgs(message, this.opts, this.sessionId);
    // stdin "ignore" is mandatory: a piped stdin makes `opencode run` block forever (see file header).
    const proc = spawnRuntimeProcess("opencode", args, { cwd: this.opts.cwd, stdio: ["ignore", "pipe", "pipe"], env: this.env });
    this.proc = proc;
    let buf = "";
    const errTail: string[] = [];
    let errLen = 0;
    let emittedError = false;
    const processLine = (ln: string) => {
      const t = ln.trim(); if (!t) return;
      let evt: any; try { evt = JSON.parse(t); } catch { return; }
      const emit = handleOpencodeEvent(evt);
      if (emit.sessionId && emit.sessionId !== this.sessionId) {
        this.sessionId = emit.sessionId; // capture the id opencode assigned so the next turn --session-resumes it
        this.cb.onSession(emit.sessionId);
      }
      if (emit.error) {
        emittedError = true;
        this.cb.onTrajectory([{ kind: "text", text: `[opencode error] (${this.opts.model}) ${emit.error.slice(0, 500)}` }]);
        this.cb.onActivity("error", emit.error.slice(0, 200));
      }
      if (emit.activity) this.cb.onActivity(emit.activity.activity, emit.activity.detail);
      if (emit.trajectory.length) this.cb.onTrajectory(emit.trajectory);
    };
    proc.stdout?.on("data", (c: Buffer) => {
      if (this.stopped) return;
      buf += c.toString(); const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const ln of lines) processLine(ln);
    });
    proc.stderr?.on("data", (c: Buffer) => {
      const t = c.toString(); errTail.push(t); errLen += t.length;
      while (errLen > 4096 && errTail.length > 1) errLen -= errTail.shift()!.length;
    });
    proc.on("error", (e) => {
      this.proc = null; this.turnBusy = false; if (this.stopped) return;
      this.cb.log.error("opencode spawn failed", { detail: String((e as any)?.message ?? e) });
      this.cb.onActivity("offline", "opencode not found");
      if (!this.everSucceeded) this.cb.onExit(1); else this.pump();
    });
    proc.on("exit", (code) => {
      if (buf.trim()) processLine(buf); buf = "";
      this.proc = null; this.turnBusy = false; if (this.stopped) return;
      if (code === 0 && !emittedError) { this.everSucceeded = true; this.cb.onActivity("online", ""); this.pump(); return; }
      const tail = errTail.join("").trim();
      const detail = tail || `opencode exited ${code ?? "signal"}`;
      if (!emittedError) {
        this.cb.onTrajectory([{ kind: "text", text: `[opencode error] (${this.opts.model}) ${clip(detail).slice(0, 500)}` }]);
        this.cb.onActivity("error", detail.split("\n").filter(Boolean).pop()!.slice(0, 200));
      }
      if (!this.everSucceeded) { this.cb.onExit(emittedError ? 1 : (code ?? 1)); return; } // first-turn hard failure → crashed
      this.pump(); // later-turn failure → keep the session alive so the next message can retry
    });
  }

  stop(): void {
    this.stopped = true;
    const p = this.proc; this.proc = null;
    if (p) { try { p.kill("SIGTERM"); } catch { /* */ } }
  }
}

export const opencodeRuntime: Runtime = {
  name: "opencode",
  experimental: true,
  start(opts: StartOpts, cb: RuntimeCallbacks): RuntimeSession {
    const modelError = validateRuntimeModel("opencode", opts.model);
    if (modelError) {
      const message = modelError;
      queueMicrotask(() => {
        cb.onTrajectory([{ kind: "text", text: `[opencode error] ${message}` }]);
        cb.onActivity("error", message);
        cb.onExit(1);
      });
      return { deliver: () => {}, stop: () => {} };
    }
    const run = new OpencodeRun(opts, cb);
    return { deliver: (text) => run.enqueue(text), stop: () => run.stop() };
  },
};
