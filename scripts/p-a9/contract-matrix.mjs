import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const PRODUCTION_WRITE_OWNERS = Object.freeze([
  {
    id: "human-message",
    source: "src/server/routes-api/messages.ts",
    owner: "MessagePostingModule",
    evidence: ['senderType: "human"', "content: b.content || \"\""],
  },
  {
    id: "human-as-task",
    source: "src/server/routes-api/messages.ts",
    owner: "TaskModule",
    evidence: ["asTask: !!b.asTask", "taskExecutionMode: mode ?? undefined"],
  },
  {
    id: "human-task-batch",
    source: "src/server/routes-api/tasks.ts",
    owner: "TaskModule",
    evidence: ["for (const task of tasks)", "asTask: true", "taskParentId: b.parentTaskId ?? null"],
  },
  {
    id: "agent-message",
    source: "src/server/routes-agent.ts",
    owner: "MessagePostingModule",
    evidence: ["const post = async", 'senderType: "agent"', "attachmentIds: attachmentIds.length"],
  },
  {
    id: "agent-introduction",
    source: "src/server/routes-agent.ts",
    owner: "MessagePostingModule",
    evidence: ["introductionAgentId: introductionTurn ? agent.id", "introductionToken: introductionTurn ? introductionToken!"],
  },
  {
    id: "agent-thread-reply",
    source: "src/server/routes-agent.ts",
    owner: "MessagePostingModule",
    evidence: ["channelId: th.id", "content: b.content"],
  },
  {
    id: "agent-task",
    source: "src/server/routes-agent.ts",
    owner: "TaskModule",
    evidence: ["for (const task of tasks)", "asTask: true", "taskParentId: parentTaskId"],
  },
  {
    id: "action-prepare",
    source: "src/server/routes-agent.ts",
    owner: "ActionModule",
    evidence: ['messageType: "action"', "actionMetadata"],
  },
  {
    id: "reminder-write",
    source: "src/server/routes-agent.ts",
    owner: "ReminderModule",
    evidence: ["db.insert(schema.reminders)", "db.update(schema.reminders)"],
  },
  {
    id: "reminder-delivery",
    source: "src/server/reminders.ts",
    owner: "MessagePostingModule",
    evidence: ['senderType: "system"', 'senderName: "reminder"', "await createMessage("],
  },
  {
    id: "internal-task-audit",
    source: "src/server/core.ts",
    owner: "TaskModule",
    evidence: ["async function sysTaskMsg", 'messageType: "system"', "publishTaskSystemMessage"],
  },
]);

export const CURRENT_CREATE_MESSAGE_CALL_SITES = Object.freeze([
  Object.freeze({ source: "src/server/reminders.ts", count: 1 }),
  Object.freeze({ source: "src/server/routes-agent.ts", count: 4 }),
  Object.freeze({ source: "src/server/routes-api/messages.ts", count: 1 }),
  Object.freeze({ source: "src/server/routes-api/tasks.ts", count: 1 }),
]);

function productionTypeScriptFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(full));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

export function findCreateMessageCallSites(root) {
  const callsBySource = new Map();
  for (const filename of productionTypeScriptFiles(path.join(root, "src"))) {
    const sourceText = readFileSync(filename, "utf8");
    const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
    const localNames = new Set();
    const namespaceNames = new Set();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "createMessage") localNames.add(element.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceNames.add(bindings.name.text);
      }
    }

    let count = 0;
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const direct = ts.isIdentifier(node.expression) && localNames.has(node.expression.text);
        const namespaced = ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "createMessage"
          && ts.isIdentifier(node.expression.expression)
          && namespaceNames.has(node.expression.expression.text);
        if (direct || namespaced) count += 1;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (count > 0) callsBySource.set(path.relative(root, filename).split(path.sep).join("/"), count);
  }
  return [...callsBySource.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

const endpoints = {
  MessagesContextModule: [
    ["GET", "/agent-api/message/check"],
    ["POST", "/agent-api/message/send"],
    ["POST", "/agent-api/message/react"],
    ["GET", "/agent-api/message/read"],
    ["GET", "/agent-api/search"],
    ["GET", "/agent-api/message/resolve"],
  ],
  ChannelsThreadsModule: [
    ["POST", "/agent-api/channel/join"],
    ["POST", "/agent-api/thread/reply"],
    ["GET", "/agent-api/thread/read"],
    ["GET", "/agent-api/channel/members"],
    ["POST", "/agent-api/channel/leave"],
    ["POST", "/agent-api/thread/unfollow"],
  ],
  TaskModule: [
    ["GET", "/agent-api/task/list"],
    ["GET", "/agent-api/task/get"],
    ["POST", "/agent-api/task/claim"],
    ["POST", "/agent-api/task/update"],
    ["POST", "/agent-api/task/assign"],
    ["POST", "/agent-api/task/new"],
    ["POST", "/agent-api/task/report"],
    ["POST", "/agent-api/task/delivery"],
    ["POST", "/agent-api/task/unclaim"],
  ],
  ActionModule: [["POST", "/agent-api/action/prepare"]],
  FilesModule: [
    ["POST", "/agent-api/attachment/upload"],
    ["GET", "/agent-api/attachment/view"],
  ],
  ProfileSpaceModule: [
    ["GET", "/agent-api/space/info"],
    ["GET", "/agent-api/profile/show"],
    ["POST", "/agent-api/profile/update"],
  ],
  ReminderModule: [
    ["POST", "/agent-api/reminder/schedule"],
    ["GET", "/agent-api/reminder/list"],
    ["POST", "/agent-api/reminder/cancel"],
    ["POST", "/agent-api/reminder/snooze"],
  ],
};

export const AGENT_ENDPOINT_OWNERS = Object.freeze(Object.entries(endpoints).flatMap(([owner, ownedEndpoints]) =>
  ownedEndpoints.map(([method, path]) => Object.freeze({ owner, method, path })),
));

export function extractAgentEndpointBranches(sourceText) {
  const sourceFile = ts.createSourceFile("routes-agent.ts", sourceText, ts.ScriptTarget.Latest, true);
  const implemented = new Set();

  function comparison(node) {
    if (!ts.isBinaryExpression(node) || ![
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
    ].includes(node.operatorToken.kind)) return null;
    if (ts.isIdentifier(node.left) && ts.isStringLiteral(node.right)) return [node.left.text, node.right.text];
    if (ts.isStringLiteral(node.left) && ts.isIdentifier(node.right)) return [node.right.text, node.left.text];
    return null;
  }

  function inspectCondition(node, matches) {
    const pair = comparison(node);
    if (pair) matches.set(pair[0], pair[1]);
    ts.forEachChild(node, (child) => inspectCondition(child, matches));
  }

  function visit(node) {
    if (ts.isIfStatement(node)) {
      const matches = new Map();
      inspectCondition(node.expression, matches);
      const routePath = matches.get("p");
      const method = matches.get("method");
      if (routePath && method) implemented.add(`${method} ${routePath}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...implemented].sort();
}

export const P_A9_4_TARGET_CONTRACTS = Object.freeze([
  ["persistent-get-or-reserve", "A durable (spaceId, chainId, messageId, targetAgentId) key returns the existing reservationId without spending wake budget twice."],
  ["admission-ack-commit", "Core commits a wake only after the current Worker generation returns admitted or queued for the matching deliveryId."],
  ["duplicate-command-ack", "Duplicate commands and admission acknowledgements are idempotent within one Worker generation."],
  ["disconnect-before-ack", "Disconnect or timeout before admission keeps the same reservation pending and replays the same deliveryId on the new Worker lease."],
  ["stale-worker-generation", "Acknowledgements from an obsolete Worker generation cannot commit a wake."],
  ["live-session-capacity", "Installation capacity counts live RuntimeSession instances and is never exceeded."],
  ["slot-release", "stop, sleep, and exit release a live-session slot exactly once."],
  ["per-agent-order", "Queued and merged deliveries preserve per-Agent ordering."],
  ["priority-aging-fairness", "Manual control outranks required delivery, which outranks optional ambient delivery, with aging across Spaces."],
  ["queued-cancel-reset", "Queued stop and reset cancel or replace work with a deterministic outcome."],
  ["shutdown-drain", "Worker shutdown has a deterministic queue drain or cancel outcome."],
  ["queue-full-expiry", "Queue-full and expiry outcomes are explicit and do not leak reservations."],
  ["unread-replay", "Accepted but unread messages replay from lastReadSeq with the same reservationId and without consuming wake budget again."],
  ["command-identities", "Wake commands reuse reservationId as deliveryId; manual and lifecycle commands use an independent commandId."],
  ["manual-command-budget", "Manual and lifecycle commands never consume message wake budget."],
  ["read-before-reply-limit", "A crash after read but before reply remains a documented Runtime contract v2 limitation, not a P-A9 guarantee."],
].map(([id, target]) => Object.freeze({ id, stage: "target-p-a9.4", target })));
