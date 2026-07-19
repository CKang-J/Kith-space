#!/usr/bin/env node
// kith-space CLI — agent-side communication layer. runtimes invoke it via their native command tools.
// Auth/routing via env vars injected by daemon at spawn time:
//   KITH_SPACE_SERVER_URL, KITH_SPACE_AGENT_TOKEN (per-agent token, injected by daemon), KITH_SPACE_AGENT_ID (or --agent-id)
import { Command } from "commander";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ROLE_TEMPLATES } from "../agents/roleTemplates.js";
import { createLogger } from "../log.js";
import { readUtf8Stdin } from "./readStdin.js";
import { BrokerGatewayClient, GatewayClientError } from "../capabilities/gatewayClient.js";

const log = createLogger("cli");
const BASE = process.env.KITH_SPACE_SERVER_URL ?? "http://127.0.0.1:7777";
const KEY = process.env.KITH_SPACE_AGENT_TOKEN;
const AGENT = process.env.KITH_SPACE_AGENT_ID ?? "";
const TURN_FILE = process.env.KITH_SPACE_TURN_FILE ?? "";
const INTRODUCTION_TOKEN = process.env.KITH_SPACE_INTRODUCTION_TOKEN ?? "";
const gatewayClient = BrokerGatewayClient.fromEnv();
const V2_ACTIVE = Boolean(process.env.KITH_SPACE_BROKER_HANDLE && process.env.KITH_SPACE_ACTIVATION_FILE);

function headers(extra: Record<string, string> = {}) {
  if (!KEY) {
    console.error("Error: KITH_SPACE_AGENT_TOKEN is required");
    process.exit(1);
  }
  return {
    authorization: `Bearer ${KEY}`,
    "x-agent-id": AGENT,
    "content-type": "application/json",
    ...extra,
  };
}
async function api(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, { method, headers: headers(extraHeaders), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    log.debug("api", { method, path, status: res.status, ms: Date.now() - t0 });
    if (!res.ok) {
      console.error(`Error: ${data.error ?? res.statusText}`);
      if (data.code) console.error(`Code: ${data.code}`);
      log.warn("api error", { method, path, status: res.status, error: data.error, code: data.code });
      process.exit(1);
    }
    return data;
  } catch (e: any) {
    console.error(`Error: ${e?.message ?? e}`);
    console.error("Code: SERVER_5XX");
    log.error("api failed", { method, path, detail: String(e?.message ?? e) });
    process.exit(1);
  }
}

async function brokerApi(method: string, path: string, body?: unknown): Promise<any> {
  try {
    return await gatewayClient.request(method as "GET" | "POST", path, body);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof GatewayClientError) console.error(`Code: ${error.code}`);
    process.exit(1);
  }
}
function targetFromText(text: string): string | null {
  const m = /^\[target=([^\s\]]+)/.exec(text);
  return m?.[1] ?? null;
}
async function recordTurnEvent(event: Record<string, unknown>): Promise<void> {
  if (!TURN_FILE) return;
  try { await appendFile(TURN_FILE, JSON.stringify({ ...event, at: Date.now() }) + "\n"); }
  catch { /* best-effort side channel for local runtime fallback */ }
}

const program = new Command();
program.name("kith-space").description("Kith-space agent CLI").version("0.1.0");

const turn = program.command("turn").description("Harness v2 turn context and output");
const printTurnContext = async (refresh = false) => {
  const data = await brokerApi("GET", `/agent-gateway/turn/context?refresh=${refresh ? "true" : "false"}`);
  console.log(`Turn ${data.turnId} -> ${data.target?.surfaceKind ?? "unknown"}:${data.target?.surfaceId ?? "unknown"}`);
  console.log(`Capability mode: ${data.capabilityMode ?? "unknown"}`);
  for (const input of data.inputs ?? []) {
    const message = input.message ?? {};
    console.log(`[input=${input.id} directive=${input.directive} channel=${input.sourceChannelId} seq=${input.sourceSeq}] @${message.senderName ?? "unknown"}: ${message.content ?? ""}`);
  }
  for (const message of data.later ?? []) console.log(`[later channel=${message.channelId} seq=${message.seq}] @${message.senderName}: ${message.content}`);
};
turn.command("context").description("show the authoritative inputs and server-owned output target for the active turn")
  .option("--refresh", "append later surface refs and rotate the freshness watermark")
  .action(async (opts) => printTurnContext(!!opts.refresh));
turn.command("reply").description("commit one server-targeted reply; body is read from UTF-8 stdin")
  .requiredOption("--input <ids>", "handled delivery input ids, comma-separated")
  .option("--attach <ids>", "temporary attachment ids, comma-separated")
  .option("--source-ref <json...>", "audited source refs as JSON objects")
  .option("--disclosure-grant <id>", "Human-issued one-shot disclosure grant")
  .option("--idempotency-key <key>", "stable retry key", "reply:primary")
  .action(async (opts) => {
    const body = (await readUtf8Stdin()).trim();
    const handledInputIds = String(opts.input).split(",").map((value) => value.trim()).filter(Boolean);
    const attachmentIds = opts.attach ? String(opts.attach).split(",").map((value) => value.trim()).filter(Boolean) : [];
    const sourceRefs = (opts.sourceRef ?? []).map((value: string) => JSON.parse(value));
    const data = await brokerApi("POST", "/agent-gateway/turn/reply", {
      schemaVersion: 1,
      body,
      attachmentIds,
      sourceRefs,
      ...(opts.disclosureGrant ? { disclosureGrantId: opts.disclosureGrant } : {}),
      handledInputIds,
      operationKey: opts.idempotencyKey,
    });
    console.log(`Replied (msg ${String(data.messageId).slice(0, 8)}, seq ${data.seq})`);
  });
turn.command("cede").description("explicitly cede optional inputs")
  .requiredOption("--input <ids>", "optional delivery input ids, comma-separated")
  .requiredOption("--reason <reason>")
  .option("--idempotency-key <key>", "stable retry key", "cede:primary")
  .action(async (opts) => {
    const inputIds = String(opts.input).split(",").map((value) => value.trim()).filter(Boolean);
    const data = await brokerApi("POST", "/agent-gateway/turn/cede", {
      schemaVersion: 1,
      inputIds,
      reason: opts.reason,
      operationKey: opts.idempotencyKey,
    });
    console.log(`Ceded ${(data.cededInputIds ?? []).length} input(s)`);
  });
turn.command("progress").description("record bounded progress for the active turn")
  .requiredOption("--text <text>").option("--idempotency-key <key>", "stable retry key", "progress:primary")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/turn/progress", { text: opts.text, idempotencyKey: opts.idempotencyKey });
    console.log(`Progress recorded (${data.progress?.ordinal ?? "?"})`);
  });
turn.command("get").description("inspect the active turn, Context, Steps, Usage and Outcome").action(async () => {
  console.log(JSON.stringify(await brokerApi("GET", "/agent-gateway/turn/get"), null, 2));
});

const context = program.command("context").description("authoritative Harness v2 context");
context.command("check").option("--refresh").action(async (opts) => printTurnContext(!!opts.refresh));

const session = program.command("session").description("surface session controls");
const checklist = session.command("checklist").description("surface-scoped short-term checklist");
checklist.command("list").action(async () => {
  const data = await brokerApi("GET", "/agent-gateway/session/checklist");
  if (!data.items?.length) return console.log("Checklist is empty.");
  for (const item of data.items) console.log(`[${item.status}] ${item.text} (id=${item.id} rev=${item.rowVersion} order=${item.sortOrder})`);
});
checklist.command("upsert").requiredOption("--text <text>").requiredOption("--order <n>")
  .option("--id <id>").option("--status <status>", "pending|in_progress|done|cancelled", "pending")
  .option("--revision <n>").option("--idempotency-key <key>", "stable retry key", "checklist:upsert")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/session/checklist/upsert", {
      ...(opts.id ? { id: opts.id } : {}), text: opts.text, status: opts.status, order: Number(opts.order),
      ...(opts.revision ? { expectedRevision: Number(opts.revision) } : {}), idempotencyKey: opts.idempotencyKey,
    });
    console.log(`Checklist ${data.item?.id} -> ${data.item?.status} rev=${data.item?.rowVersion}`);
  });
checklist.command("complete").requiredOption("--id <id>").requiredOption("--text <text>").requiredOption("--order <n>")
  .requiredOption("--revision <n>").option("--idempotency-key <key>", "stable retry key", "checklist:complete")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/session/checklist/upsert", {
      id: opts.id, text: opts.text, status: "done", order: Number(opts.order), expectedRevision: Number(opts.revision),
      idempotencyKey: opts.idempotencyKey,
    });
    console.log(`Checklist ${data.item?.id} completed rev=${data.item?.rowVersion}`);
  });
checklist.command("clear").option("--open-only").option("--idempotency-key <key>", "stable retry key", "checklist:clear")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/session/checklist/clear", {
      includeCompleted: !opts.openOnly, idempotencyKey: opts.idempotencyKey,
    });
    console.log(`Cleared ${data.cleared ?? 0} checklist item(s)`);
  });
session.command("wake").description("schedule one short wake for this surface session")
  .requiredOption("--in <seconds>").requiredOption("--reason <reason>")
  .option("--idempotency-key <key>", "stable retry key", "wakeup:primary")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/session/wakeup", {
      delaySeconds: Number(opts.in), reason: opts.reason, idempotencyKey: opts.idempotencyKey,
    });
    console.log(`Wake scheduled for ${new Date(data.wakeup?.dueAt).toISOString()} (${data.wakeup?.id})`);
  });

const conversation = program.command("conversation").description("authoritative audited conversation queries");
conversation.command("read").requiredOption("--channel-id <id>").option("--limit <n>", "number of messages", "50")
  .option("--after <seq>").action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/conversation/read", {
      channelId: opts.channelId, limit: Number(opts.limit), ...(opts.after ? { afterSeq: Number(opts.after) } : {}),
    });
    for (const message of data.messages ?? []) console.log(`[${message.seq}] @${message.senderName}: ${message.content} (${String(message.id).slice(0, 8)})`);
  });

const memory = program.command("memory").description("disclosure-safe episodic memory queries");
memory.command("recall").requiredOption("--query <query>").option("--no-continuity")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/memory/recall", {
      query: opts.query,
      includeContinuity: opts.continuity !== false,
    });
    for (const item of data.results ?? []) {
      console.log(`[${item.scope}:${item.projection}] ${item.content ?? `(reference ${item.memoryId})`} (id=${item.memoryId} rev=${item.memoryRevision})`);
    }
  });
memory.command("get").requiredOption("--id <memoryId>").action(async (opts) => {
  const data = await brokerApi("POST", "/agent-gateway/memory/get", { memoryId: opts.id });
  const item = data.memory;
  console.log(`[${item.scope}:${item.projection}] ${item.content ?? `(reference ${item.memoryId})`} (id=${item.memoryId} rev=${item.memoryRevision})`);
});
conversation.command("search").requiredOption("--query <query>").option("--limit <n>", "number of results", "20")
  .action(async (opts) => {
    const data = await brokerApi("POST", "/agent-gateway/conversation/search", { query: opts.query, limit: Number(opts.limit) });
    for (const message of data.results ?? []) console.log(`[${message.channelId}:${message.seq}] @${message.senderName}: ${message.content} (${String(message.id).slice(0, 8)})`);
  });

const capability = program.command("capability").description("active Harness v2 capability discovery");
capability.command("describe").action(async () => {
  console.log(JSON.stringify(await brokerApi("GET", "/agent-gateway/capability/describe"), null, 2));
});

const roleTemplate = program.command("role-template").description("optional role starting points for agent:create actions");
roleTemplate.command("list").description("list role template ids and their editable starting prompts").action(() => {
  for (const template of ROLE_TEMPLATES) console.log(`${template.id}\t${template.label}${template.description ? `\t${template.description}` : ""}`);
});

const message = program.command("message").description("message send/receive");
message.command("check").description("non-blocking check for new messages").action(async () => {
  if (process.env.KITH_SPACE_BROKER_HANDLE && process.env.KITH_SPACE_ACTIVATION_FILE) return printTurnContext(false);
  const d = await api("GET", "/agent-api/message/check");
  if (!d.messages?.length) { await recordTurnEvent({ type: "check", count: 0 }); return console.log("No new messages."); }
  const targets = Array.from(new Set((d.messages ?? []).map((m: any) => targetFromText(String(m.text ?? ""))).filter(Boolean)));
  await recordTurnEvent({ type: "check", count: d.messages.length, target: targets[targets.length - 1] ?? null, targets });
  for (const m of d.messages) console.log(m.text);
  console.log("No more new messages."); // termination sentinel
});
message.command("send").description("send a message (body read from stdin); if new messages arrived since last read the message is freshness-held as a draft — revise it or use --send-draft to submit as-is").requiredOption("--target <target>", "#channel / dm:@name / #channel:shortid / thread:shortid").option("--attach <ids>", "attachment ids, comma-separated").option("--send-draft", "submit the held draft as-is, bypassing freshness check").option("--introduction", "identify the one-time creation introduction").action(async (opts) => {
  const sendDraft = !!opts.sendDraft;
  const content = sendDraft ? "" : (await readUtf8Stdin()).trim();
  const attachmentIds = opts.attach ? String(opts.attach).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  if (!sendDraft && !content && !attachmentIds.length) { console.error("Error: empty content"); console.error("Next action: pipe the body as UTF-8 stdin using host-native syntax, or use --attach"); process.exit(1); }
  const d = await api("POST", "/agent-api/message/send", { target: opts.target, content, attachmentIds, sendDraft },
    opts.introduction && INTRODUCTION_TOKEN ? { "x-kith-introduction-token": INTRODUCTION_TOKEN } : undefined);
  if (d.held) { await recordTurnEvent({ type: "held", target: opts.target }); return console.log(d.text); } // freshness-hold: prints bounded context + two options, letting the agent revise or use --send-draft
  await recordTurnEvent({ type: "send", target: opts.target, id: d.id, seq: d.seq });
  console.log(`Sent to ${opts.target} (msg ${String(d.id).slice(0, 8)}, seq ${d.seq})`);
});
message.command("read").description("read channel history (supports anchor flags --before/--after/--around: message short/full id or seq, jumps to the specified context)")
  .requiredOption("--channel <channel>").option("--limit <n>", "number of messages", "50")
  .option("--around <idOrSeq>", "fetch context centered on this message").option("--before <idOrSeq>", "fetch messages before this one").option("--after <idOrSeq>", "fetch messages after this one").action(async (opts) => {
    const q = new URLSearchParams({ channel: opts.channel, limit: String(opts.limit) });
    if (opts.around) q.set("around", opts.around); else if (opts.before) q.set("before", opts.before); else if (opts.after) q.set("after", opts.after);
    const d = await api("GET", `/agent-api/message/read?${q}`);
    await recordTurnEvent({ type: "read", target: opts.channel, count: d.messages?.length ?? 0 });
    for (const m of d.messages ?? []) console.log(m.text);
  });
message.command("react").description("add or remove a reaction emoji on a message (lightweight feedback)").requiredOption("--message-id <id>").requiredOption("--emoji <emoji>", "e.g. 👍 ✅").option("--remove", "remove the reaction instead of adding it").action(async (opts) => {
  const d = await api("POST", "/agent-api/message/react", { messageId: opts.messageId, emoji: opts.emoji, remove: !!opts.remove });
  console.log(`${opts.remove ? "Removed" : "Reacted"} ${opts.emoji} -> ${(d.reactions ?? []).map((r: any) => `${r.emoji}×${r.count}`).join(" ") || "(none)"}`);
});

const attachment = program.command("attachment").description("attachments");
attachment.command("upload").description("upload a file (returns attachmentId; use turn reply --attach during a v2 turn)").requiredOption("--file <path>").option("--channel <channel>", "legacy only: #name / dm:@name").action(async (opts) => {
  const buf = await readFile(opts.file);
  const fd = new FormData();
  if (opts.channel) fd.append("channel", opts.channel);
  fd.append("files", new Blob([new Uint8Array(buf)]), basename(opts.file));
  let d: any;
  if (V2_ACTIVE) {
    try { d = await gatewayClient.upload("/agent-gateway/turn/attachment/upload", fd); }
    catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof GatewayClientError) console.error(`Code: ${error.code}`);
      process.exit(1);
    }
  } else {
    if (!opts.channel) { console.error("Error: --channel is required outside an active Harness v2 turn"); process.exit(1); }
    const res = await fetch(BASE + "/agent-api/attachment/upload", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "x-agent-id": AGENT }, body: fd });
    d = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`Error: ${d.error ?? res.statusText}`); if (d.code) console.error(`Code: ${d.code}`); process.exit(1); }
  }
  for (const a of d.attachments ?? []) console.log(`Uploaded ${a.filename} -> ${a.attachmentId}`);
});

const space = program.command("space").description("Space information");
space.command("info").description("list channels, agents, and the Human").action(async () => {
  const d = await api("GET", "/agent-api/space/info");
  let out = "## Space\n\n### Channels\n";
  out += (d.channels ?? []).map((c: any) => `  - #${c.name}${c.joined ? " [joined]" : " [not joined]"}${c.description ? " — " + c.description : ""}`).join("\n") || "  (none)";
  const desc1 = (s: any) => (s ? " — " + String(s).replace(/\s+/g, " ").trim() : ""); // single-line description display (`@name — description`)
  out += "\n\n### Agents\n" + ((d.agents ?? []).map((a: any) => `  - @${a.name} (${a.status})${desc1(a.description)}`).join("\n") || "  (none)");
  out += "\n\n### Human\n" + (d.human ? `  - @${d.human.name}${desc1(d.human.description)}` : "  (none)");
  console.log(out);
});

const channel = program.command("channel").description("channels");
channel.command("join").requiredOption("--target <name>").action(async (opts) => {
  const d = await api("POST", "/agent-api/channel/join", { target: opts.target });
  console.log(`Joined #${d.joined}`);
});

const task = program.command("task").description("tasks");
async function v2TaskId(opts: { messageId?: string; channel?: string; number?: string }): Promise<string> {
  if (opts.messageId) return opts.messageId;
  if (opts.number == null || !opts.channel) throw new Error("--message-id or --channel with --number is required");
  const listed = await brokerApi("POST", "/agent-gateway/task/list", { channel: opts.channel });
  const match = (listed.tasks ?? []).find((candidate: any) => Number(candidate.taskNumber) === Number(opts.number));
  if (!match?.id) throw new Error(`task #${opts.number} was not found in ${opts.channel}`);
  return match.id;
}
task.command("list").requiredOption("--channel <channel>").action(async (opts) => {
  const d = V2_ACTIVE
    ? await brokerApi("POST", "/agent-gateway/task/list", { channel: opts.channel })
    : await api("GET", `/agent-api/task/list?channel=${encodeURIComponent(opts.channel)}`);
  if (!d.tasks?.length) return console.log("No tasks.");
  for (const t of d.tasks) console.log(`  task #${t.number ?? "-"} [${t.status}] rev=${t.revision ?? 0} ${t.content}  (${String(t.id).slice(0, 8)})${t.parentTaskId ? ` parent=${String(t.parentTaskId).slice(0, 8)}` : ""}`);
});
task.command("get").description("show a task with its children, thread reports, and deliveries").requiredOption("--message-id <id>").action(async (opts) => {
  const d = V2_ACTIVE
    ? await brokerApi("POST", "/agent-gateway/task/get", { taskId: opts.messageId })
    : await api("GET", `/agent-api/task/get?messageId=${encodeURIComponent(opts.messageId)}`);
  console.log(`Task #${d.task?.taskNumber ?? "?"} [${d.task?.taskStatus}] rev=${d.task?.taskRevision ?? 0}: ${d.task?.content ?? ""}`);
  for (const child of d.children ?? []) console.log(`  child #${child.taskNumber ?? "?"} [${child.taskStatus}] ${child.content} (${String(child.id).slice(0, 8)})`);
  for (const report of d.reports ?? []) console.log(`  report ${String(report.id).slice(0, 8)} @${report.senderName}: ${report.content}`);
  for (const delivery of d.deliveries ?? []) console.log(`  delivery ${String(delivery.id).slice(0, 8)}: ${delivery.content}`);
});
task.command("claim").description("claim a task (--message-id short/full id, or --channel #ch --number N by task number)")
  .option("--message-id <id>").option("--channel <ch>", "#name / dm:@name (used with --number)").option("--number <n>", "task number #N").option("--revision <n>", "expected task revision").option("--idempotency-key <key>")
  .action(async (opts) => {
    const body: Record<string, unknown> = opts.number != null ? { channel: opts.channel, number: Number(opts.number) } : { messageId: opts.messageId };
    if (opts.revision != null) body.expectedRevision = Number(opts.revision);
    let d;
    if (V2_ACTIVE) {
      const taskId = await v2TaskId(opts);
      d = await brokerApi("POST", "/agent-gateway/task/claim", {
        taskId, ...(opts.revision != null ? { expectedRevision: Number(opts.revision) } : {}),
        idempotencyKey: opts.idempotencyKey ?? `task:claim:${taskId}`,
      });
      d.claimed = d.taskId;
    } else d = await api("POST", "/agent-api/task/claim", body);
    console.log(`Claimed #${d.number ?? "?"} rev=${d.revision ?? "?"} (${String(d.claimed).slice(0, 8)})`);
    if (d.followUp) console.log(d.followUp); // guidance: report progress in the task thread
  });
task.command("update").description("update task status (--message-id, or --channel #ch --number N)")
  .option("--message-id <id>").option("--channel <ch>", "#name / dm:@name (used with --number)").option("--number <n>", "task number #N")
  .option("--from <status>", "expected current status").option("--revision <n>", "expected task revision").option("--idempotency-key <key>")
  .requiredOption("--status <status>", "todo|in_progress|in_review|done|closed").action(async (opts) => {
    const body: Record<string, unknown> = { status: opts.status };
    if (opts.number != null) { body.channel = opts.channel; body.number = Number(opts.number); } else body.messageId = opts.messageId;
    if (opts.from) body.from = opts.from;
    if (opts.revision != null) body.expectedRevision = Number(opts.revision);
    const taskId = V2_ACTIVE ? await v2TaskId(opts) : "";
    const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/update", {
      taskId, status: opts.status, ...(opts.from ? { from: opts.from } : {}),
      ...(opts.revision != null ? { expectedRevision: Number(opts.revision) } : {}),
      idempotencyKey: opts.idempotencyKey ?? `task:update:${taskId}:${opts.status}`,
    }) : await api("POST", "/agent-api/task/update", body);
    console.log(`Updated -> ${opts.status} (rev=${d.revision ?? "?"})`);
  });
task.command("assign").description("hand off a task to another agent (--message-id, or --channel #ch --number N)")
  .option("--message-id <id>").option("--channel <ch>", "#name / dm:@name (used with --number)").option("--number <n>", "task number #N").option("--revision <n>", "expected task revision")
  .requiredOption("--to <agent>", "@agent handle").option("--idempotency-key <key>").action(async (opts) => {
    const body: Record<string, unknown> = { to: opts.to };
    if (opts.number != null) { body.channel = opts.channel; body.number = Number(opts.number); } else body.messageId = opts.messageId;
    if (opts.revision != null) body.expectedRevision = Number(opts.revision);
    const taskId = V2_ACTIVE ? await v2TaskId(opts) : "";
    const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/assign", {
      taskId, to: opts.to, ...(opts.revision != null ? { expectedRevision: Number(opts.revision) } : {}),
      idempotencyKey: opts.idempotencyKey ?? `task:assign:${taskId}:${opts.to}`,
    }) : await api("POST", "/agent-api/task/assign", body);
    console.log(`Assigned task #${d.number ?? "?"} rev=${d.revision ?? "?"} -> @${d.to}`);
    if (d.followUp) console.log(d.followUp);
  });
const taskCreate = async (opts: { channel: string; title: string; mode?: string; parent?: string }) => {
  const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/create", {
    channel: opts.channel,
    title: opts.title,
    executionMode: opts.mode ?? "autopilot",
    ...(opts.parent ? { parentTaskId: opts.parent } : {}),
    idempotencyKey: `task:create:${opts.channel}:${opts.title}`,
  }) : await api("POST", "/agent-api/task/new", { target: opts.channel, title: opts.title, executionMode: opts.mode, parentTaskId: opts.parent });
  if (V2_ACTIVE) d.tasks = [{ id: d.taskId, number: d.number, content: opts.title }];
  for (const t of d.tasks ?? []) console.log(`Created task #${t.number ?? "-"} ${String(t.id).slice(0, 8)}: ${t.content}`);
};
task.command("new").description("create a new task (delegate work)").requiredOption("--channel <channel>", "#name / dm:@name").requiredOption("--title <title>").option("--mode <mode>", "autopilot|plan-first").option("--parent <taskId>", "direct parent task id").action(taskCreate);
task.command("create").description("create a new task (alias for task new)").requiredOption("--channel <channel>").requiredOption("--title <title>").option("--mode <mode>", "autopilot|plan-first").option("--parent <taskId>", "direct parent task id").action(taskCreate);
task.command("report").description("post a structured report in the task thread").requiredOption("--message-id <id>").requiredOption("--kind <kind>", "progress|blocker|question|result").requiredOption("--content <text>").option("--idempotency-key <key>").action(async (opts) => {
  const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/report", {
    taskId: opts.messageId, kind: opts.kind, content: opts.content,
    idempotencyKey: opts.idempotencyKey ?? `task:report:${opts.messageId}:${opts.kind}`,
  }) : await api("POST", "/agent-api/task/report", { messageId: opts.messageId, kind: opts.kind, content: opts.content });
  console.log(`Reported in ${d.threadTarget ?? d.threadId} (msg ${String(d.reportMessageId).slice(0, 8)})`);
});
task.command("deliver").description("publish a linked delivery summary to the task channel and move it to in_review")
  .requiredOption("--message-id <id>").requiredOption("--revision <n>", "expected task revision").requiredOption("--summary <text>")
  .option("--children <ids>", "direct child task ids, comma-separated").option("--idempotency-key <key>").action(async (opts) => {
    const childTaskIds = opts.children ? String(opts.children).split(",").map((id: string) => id.trim()).filter(Boolean) : [];
    const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/deliver", {
      taskId: opts.messageId, expectedRevision: Number(opts.revision), summary: opts.summary, childTaskIds,
      idempotencyKey: opts.idempotencyKey ?? `task:deliver:${opts.messageId}`,
    }) : await api("POST", "/agent-api/task/delivery", { messageId: opts.messageId, expectedRevision: Number(opts.revision), summary: opts.summary, childTaskIds });
    console.log(`Delivered (msg ${String(d.deliveryMessageId).slice(0, 8)}, status=${d.status}, rev=${d.revision})`);
  });

const searchAction = async (opts: { query: string }) => {
  const d = await api("GET", `/agent-api/search?q=${encodeURIComponent(opts.query)}`);
  if (!d.results?.length) return console.log("No matches.");
  for (const m of d.results) console.log(`[${m.senderType}] @${m.senderName}: ${m.content}  (${String(m.id).slice(0, 8)})`);
};
// message search (as taught in the standing prompt); top-level search kept as a backward-compat alias
message.command("search").description("full-text search messages in your channels").requiredOption("--query <q>", "search term").action(searchAction);
program.command("search").description("= message search (backward-compat alias)").requiredOption("--query <q>", "search term").action(searchAction);

const thread = program.command("thread").description("threads");
thread.command("reply").description("start or reply to a thread under a message (body read from stdin)").requiredOption("--parent <msgId>", "parent message id or the 8-character short id from the message header").option("--channel <channel>", "channel containing the parent message (used for disambiguation)").action(async (opts) => {
  const content = (await readUtf8Stdin()).trim();
  if (!content) { console.error("Error: empty content"); console.error("Next action: pipe the body as UTF-8 stdin using host-native syntax"); process.exit(1); }
  const d = await api("POST", "/agent-api/thread/reply", { parent: opts.parent, channel: opts.channel, content });
  console.log(`Replied in thread (thread ${String(d.threadChannelId).slice(0, 8)}, msg ${String(d.id).slice(0, 8)})`);
});
thread.command("unfollow").description("stop receiving deliveries from a thread").requiredOption("--target <thread>", "#channel:shortid or thread:shortid").action(async (opts) => {
  await api("POST", "/agent-api/thread/unfollow", { target: opts.target });
  console.log(`Unfollowed ${opts.target}`);
});
thread.command("read").description("read thread replies under a message").requiredOption("--parent <msgId>").option("--channel <channel>").action(async (opts) => {
  const d = await api("GET", `/agent-api/thread/read?parent=${encodeURIComponent(opts.parent)}${opts.channel ? "&channel=" + encodeURIComponent(opts.channel) : ""}`);
  console.log(`[parent] @${d.parent?.senderName}: ${d.parent?.content}`);
  if (!d.messages?.length) return console.log("(no replies yet)");
  for (const m of d.messages) console.log(m.text);
});

// additional commands: message resolve / channel members+leave / task unclaim / attachment view / profile
message.command("resolve").description("verify a message id and print its canonical line (guards against hallucinated references)").requiredOption("--id <id>").action(async (opts) => {
  const d = await api("GET", `/agent-api/message/resolve?id=${encodeURIComponent(opts.id)}`);
  console.log(d.text || `${d.id} @${d.senderName}: ${d.content}`);
});
channel.command("members").description("list members of a channel, DM, or thread").requiredOption("--channel <channel>").action(async (opts) => {
  const d = await api("GET", `/agent-api/channel/members?channel=${encodeURIComponent(opts.channel)}`);
  for (const m of d.members ?? []) console.log(`  [${m.type}] ${m.displayName || m.name} (@${m.name})`);
});
channel.command("leave").description("leave a channel you have joined").requiredOption("--target <name>").action(async (opts) => {
  await api("POST", "/agent-api/channel/leave", { target: opts.target });
  console.log(`Left ${opts.target}`);
});
task.command("unclaim").description("release your claim on a task").requiredOption("--message-id <id>").option("--revision <n>", "expected task revision").action(async (opts) => {
  const d = V2_ACTIVE ? await brokerApi("POST", "/agent-gateway/task/unclaim", {
    taskId: opts.messageId, ...(opts.revision == null ? {} : { expectedRevision: Number(opts.revision) }),
    idempotencyKey: `task:unclaim:${opts.messageId}`,
  }) : await api("POST", "/agent-api/task/unclaim", { messageId: opts.messageId, expectedRevision: opts.revision == null ? undefined : Number(opts.revision) });
  console.log(`Unclaimed -> ${d.taskStatus ?? d.status}`);
});
attachment.command("view").description("download an attachment to the local workspace (saves to disk — inspect with your own tools: images via visual read, text via cat/Read); text content is also printed inline")
  .requiredOption("--id <id>").option("--out <dir>", "output directory (default: ./attachments)").action(async (opts) => {
  const d = await api("GET", `/agent-api/attachment/view?id=${encodeURIComponent(opts.id)}`);
  if (d.base64 != null) {
    const dir = opts.out || "attachments";
    await mkdir(dir, { recursive: true });
    const fp = join(dir, d.filename || ("attachment-" + String(opts.id).slice(0, 8)));
    await writeFile(fp, Buffer.from(d.base64, "base64"));
    console.log(`Saved ${d.filename} (${d.mimeType || "?"}, ${d.sizeBytes} B) → ${fp}`);
    console.log(`It is now a regular local file — inspect it with your own tools.`);
    if (d.text != null) console.log("\n--- text content ---\n" + d.text);
  } else {
    console.log(`${d.filename} (${d.mimeType || "?"}, ${d.sizeBytes} B)`);
    console.log(d.text != null ? d.text : (d.note || "(no inline content)"));
  }
});
const profile = program.command("profile").description("profiles");
profile.command("show").description("view your own profile or that of a @handle").option("--handle <handle>", "@name — omit to show your own").action(async (opts) => {
  const d = await api("GET", `/agent-api/profile/show${opts.handle ? "?handle=" + encodeURIComponent(opts.handle) : ""}`);
  console.log(`[${d.type}] ${d.displayName || d.name} (@${d.name})${d.runtime ? " · " + d.runtime + "/" + (d.model || "") : ""}`);
  if (d.description) console.log(`  ${d.description}`);
});
profile.command("update").description("update your own profile (provide at least one option)").option("--display-name <name>").option("--description <text>").option("--avatar-url <url>", "e.g. pixel:random:<seed>").action(async (opts) => {
  const d = await api("POST", "/agent-api/profile/update", { displayName: opts.displayName, description: opts.description, avatarUrl: opts.avatarUrl });
  console.log(`Profile updated: ${Object.keys(d).filter((k) => k !== "ok").join(", ")}`);
});

const reminder = program.command("reminder").description("reminders (self-scheduled — wakes you up at the specified time)");
reminder.command("schedule").description("schedule a reminder for yourself").requiredOption("--content <text>").option("--in <seconds>", "trigger after this many seconds").option("--at <iso>", "trigger at a specific ISO timestamp").option("--anchor <msgId>", "anchor message id").option("--recurring <seconds>", "repeat interval in seconds").action(async (opts) => {
  const d = await api("POST", "/agent-api/reminder/schedule", { content: opts.content, in: opts.in, at: opts.at, anchor: opts.anchor, recurring: opts.recurring });
  console.log(`Scheduled reminder ${d.id} at ${d.remindAt}`);
});
reminder.command("list").description("list your reminders").action(async () => {
  const d = await api("GET", "/agent-api/reminder/list");
  if (!d.reminders?.length) return console.log("No reminders.");
  for (const r of d.reminders) console.log(`  ${r.id} [${r.status}] ${r.remindAt}: ${r.content}${r.recurrence ? ` (every ${r.recurrence}s)` : ""}`);
});
reminder.command("cancel").description("cancel a reminder").requiredOption("--id <id>").action(async (opts) => { await api("POST", "/agent-api/reminder/cancel", { id: opts.id }); console.log(`Cancelled ${opts.id}`); });
reminder.command("snooze").description("postpone a reminder").requiredOption("--id <id>").requiredOption("--in <seconds>").action(async (opts) => { await api("POST", "/agent-api/reminder/snooze", { id: opts.id, in: opts.in }); console.log(`Snoozed ${opts.id}`); });

// action prepare: B-mode quick-commit. agent:create accepts optional roleTemplate; an explicit description wins.
// Agents still lack channel:create/agent:create scope, so the card needs a human click and executes under the human's identity.
const action = program.command("action").description("prepare human-in-the-loop action cards (human commit)");
action.command("prepare").description("prepare an action card (action JSON from stdin; variants: channel:create / agent:create)")
  .requiredOption("--target <ch>", "#channel / dm:@name").action(async (opts) => {
    const raw = (await readUtf8Stdin()).trim();
    if (!raw) { console.error("Error: action JSON required on stdin"); console.error("Next action: provide UTF-8 JSON via stdin using the host-native syntax from the system prompt"); process.exit(1); }
    let actionObj: unknown;
    try { actionObj = JSON.parse(raw); } catch { console.error("Error: invalid JSON on stdin"); process.exit(1); }
    const d = await api("POST", "/agent-api/action/prepare", { target: opts.target, action: actionObj });
    console.log(`Prepared ${d.action?.type} card -> ${opts.target} (msg ${String(d.id).slice(0, 8)}). A human can click it to commit.`);
  });

program.parseAsync(process.argv).catch((e) => { console.error("Error:", e?.message ?? e); process.exit(1); });
