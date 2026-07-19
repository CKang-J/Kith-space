// claude runtime: `claude -p stream-json` continuous session. User messages are written to stdin to drive turns;
// stdout is parsed as stream-json events.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Runtime, StartOpts, RuntimeCallbacks, RuntimeSession, TrajectoryEntry } from "./runtime.js";
import { spawnRuntimeProcess } from "./runtimeProcess.js";

const MAX = 2000;
const clip = (s: unknown) => String(s ?? "").slice(0, MAX);
function summarize(tool: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  if (tool === "Bash") return clip(input.command).slice(0, 120);
  if (["Read", "Write", "Edit"].includes(tool)) return input.file_path ?? input.path ?? "";
  return "";
}

// Effort levels the claude CLI accepts (`claude --help`: --effort <low|medium|high|xhigh|max>).
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Pure argv builder (unit-tested). model/effort are OPTIONAL: when absent, NEITHER --model NOR --effort
// is emitted, so the claude CLI falls back to ~/.claude settings (the "use local default" contract).
// effort is validated against CLAUDE_EFFORTS here (last-line injection guard) so a bogus caller value
// never reaches the shell. #65 added effort levels to the UI picker but never wired them through — this closes that gap.
export function buildClaudeArgs(p: {
  promptFileFlag: string[];
  model?: string | null;
  reasoningEffort?: string | null;
  sessionId?: string | null;
  mcpConfigFile?: string | null;
}): string[] {
  const args = [
    "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
    "--dangerously-skip-permissions", "--permission-mode", "bypassPermissions", "--include-partial-messages",
    "--disallowed-tools", "EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete,AskUserQuestion",
    ...p.promptFileFlag,
  ];
  if (p.model) args.push("--model", p.model);
  const effort = typeof p.reasoningEffort === "string" && CLAUDE_EFFORTS.has(p.reasoningEffort) ? p.reasoningEffort : null;
  if (effort) args.push("--effort", effort);
  if (p.sessionId) args.push("--resume", p.sessionId);
  if (p.mcpConfigFile) args.push("--mcp-config", p.mcpConfigFile, "--strict-mcp-config");
  return args;
}

export function claudePromptFile(opts: Pick<StartOpts, "cwd" | "runtimeStateDir">): string {
  return path.join(opts.runtimeStateDir ?? opts.cwd, "claude-system-prompt.md");
}

export const claudeRuntime: Runtime = {
  name: "claude",
  start(opts: StartOpts, cb: RuntimeCallbacks): RuntimeSession {
    // Spawn args aligned with daemon driver behavior: bypassPermissions + partial streaming +
    // planning/cron/ask tools disabled (they cause undesirable autonomous-agent detours).
    // Standing prompt written to a file then passed via --append-system-prompt-file (avoids excessively long CLI args).
    let promptFlag = ["--append-system-prompt", opts.systemPrompt];
    try { const pf = claudePromptFile(opts); writeFileSync(pf, opts.systemPrompt); promptFlag = ["--append-system-prompt-file", pf]; } catch { /* fallback to inline */ }
    const rc = opts.runtimeConfig;
    const args = buildClaudeArgs({
      promptFileFlag: promptFlag,
      model: opts.model,
      reasoningEffort: rc && typeof rc.reasoningEffort === "string" ? rc.reasoningEffort : null,
      sessionId: opts.sessionId,
      mcpConfigFile: typeof opts.mcpBootstrap?.descriptor.configFile === "string"
        ? opts.mcpBootstrap.descriptor.configFile
        : null,
    });

    const proc = spawnRuntimeProcess("claude", args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], env: opts.env });
    let sessionId = opts.sessionId ?? null;
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      cb.onExit(code);
    };
    const writeUser = (text: string) => {
      const m = { type: "user", message: { role: "user", content: [{ type: "text", text }] }, ...(sessionId ? { session_id: sessionId } : {}) };
      try { proc.stdin?.write(JSON.stringify(m) + "\n"); } catch { /* */ }
    };
    writeUser(opts.initialPrompt);

    let buf = "";
    proc.stdout?.on("data", (c: Buffer) => {
      buf += c.toString(); const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const ln of lines) { if (ln.trim()) parseLine(ln); }
    });
    proc.stderr?.on("data", (c: Buffer) => { const t = c.toString().trim(); if (t) cb.log.debug("claude stderr", { t: t.slice(0, 300) }); });
    proc.on("error", (e) => {
      cb.log.error("claude spawn failed", { detail: String((e as any)?.message ?? e) });
      cb.onActivity("offline", "claude not found");
      finish(1);
    });
    proc.on("exit", (code) => finish(code));

    function parseLine(line: string) {
      let e: any; try { e = JSON.parse(line); } catch { return; }
      if (e.type === "system" && e.subtype === "init" && e.session_id) {
        sessionId = e.session_id; cb.onSession(e.session_id); cb.onActivity("working", "starting");
      } else if (e.type === "result") {
        if (e.session_id) { sessionId = e.session_id; cb.onSession(e.session_id); }
        const usage = e.usage && typeof e.usage === "object" ? e.usage : {};
        if (Object.keys(usage).length || typeof e.duration_ms === "number" || typeof e.total_cost_usd === "number") {
          cb.onUsage?.({
            ...(Number.isFinite(usage.input_tokens) ? { inputTokens: usage.input_tokens } : {}),
            ...(Number.isFinite(usage.output_tokens) ? { outputTokens: usage.output_tokens } : {}),
            ...(Number.isFinite(usage.cache_read_input_tokens) ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
            ...(Number.isFinite(usage.cache_creation_input_tokens) ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {}),
            ...(Number.isFinite(e.total_cost_usd) ? { costUsd: e.total_cost_usd } : {}),
            ...(Number.isFinite(e.duration_ms) ? { durationMs: e.duration_ms } : {}),
            source: "final",
          });
        }
        const failed = e.is_error === true || (typeof e.subtype === "string" && e.subtype !== "success");
        cb.onActivity(failed ? "error" : "online", failed ? clip(e.result || e.subtype || "claude turn failed") : "");
        cb.onTurnResult?.({ outcome: failed ? "failed" : "completed", ...(failed ? { errorCode: `claude_${e.subtype || "error"}` } : {}) });
      } else if (e.type === "assistant") {
        const content = e.message?.content; const traj: TrajectoryEntry[] = []; let activity = "thinking", detail = "";
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "thinking" && b.thinking) traj.push({ kind: "thinking", text: clip(b.thinking) });
            else if (b.type === "text" && b.text) traj.push({ kind: "text", text: clip(b.text) });
            else if (b.type === "tool_use") traj.push({ kind: "tool", toolName: b.name, toolInput: summarize(b.name, b.input) });
          }
          const tools = content.filter((c: any) => c.type === "tool_use");
          if (tools.length) { activity = "working"; detail = summarize(tools[tools.length - 1].name, tools[tools.length - 1].input) || tools[tools.length - 1].name; }
        }
        cb.onActivity(activity, detail);
        if (traj.length) cb.onTrajectory(traj);
      }
    }

    return { deliver: (text) => writeUser(text), stop: () => { try { proc.kill("SIGTERM"); } catch { /* */ } } };
  },
};
