import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closeAllDatabases } from "../src/db/index.ts";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "../src/messages/messagePostingModule.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, schema, spaceId, human } = integrationDatabase("p-a9-conversation-transaction");
const sqlite = db.$client;

function modules(eventSink: ConversationEventSink = { async publish() {} }) {
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId };
    },
    async ensureChain(input) {
      db.insert(schema.dispatchChains).values({
        id: input.dispatch.chainId,
        spaceId,
        rootMessageId: input.rootMessageId,
        taskMessageId: input.dispatch.taskMessageId,
        channelId: input.channelId,
        maxDepthSeen: input.dispatch.dispatchDepth,
      }).onConflictDoNothing().run();
    },
    async prepareTargets() { return { async dispatch() { return { status: "sent" }; } }; },
    async dispatch() { return { status: "sent" }; },
  };
  return createConversationModules({
    eventSink,
    wakeDispatch,
    introductionProof: { consume: () => true, complete() {}, restore() {} },
  });
}

try {
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: "transaction-contract",
    type: "channel",
  }).returning();
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "transaction-agent",
    displayName: "Transaction Agent",
    runtime: "codex",
    creatorId: human.id,
  }).returning();
  assert.ok(channel && agent);
  const context = {
    spaceId,
    channelId: channel.id,
    sender: { type: "human" as const, id: human.id, name: human.name },
  };

  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_atomic_chain
    BEFORE INSERT ON dispatch_chains
    BEGIN SELECT RAISE(ABORT, 'p-a9 atomic chain failure'); END;
  `);
  await assert.rejects(
    modules().messagePosting.post({ kind: "chat", context, content: "atomic chain" }),
    /p-a9 atomic chain failure/,
  );
  assert.equal(db.select().from(schema.messages).where(eq(schema.messages.content, "atomic chain")).get(), undefined);
  sqlite.exec("DROP TRIGGER p_a9_fail_atomic_chain;");

  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_atomic_mention
    BEFORE INSERT ON message_mentions
    BEGIN SELECT RAISE(ABORT, 'p-a9 atomic mention failure'); END;
  `);
  await assert.rejects(
    modules().messagePosting.post({ kind: "chat", context, content: "@transaction-agent atomic mention" }),
    /p-a9 atomic mention failure/,
  );
  assert.equal(db.select().from(schema.messages).where(eq(schema.messages.content, "@transaction-agent atomic mention")).get(), undefined);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, agent.id),
  )).get(), undefined);
  sqlite.exec("DROP TRIGGER p_a9_fail_atomic_mention;");

  const [attachment] = await db.insert(schema.attachments).values({
    spaceId,
    filename: "atomic.txt",
    mimeType: "text/plain",
    sizeBytes: 6,
    storageKey: "atomic.txt",
  }).returning();
  assert.ok(attachment);
  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_atomic_attachment
    BEFORE UPDATE OF message_id ON attachments
    BEGIN SELECT RAISE(ABORT, 'p-a9 atomic attachment failure'); END;
  `);
  await assert.rejects(
    modules().messagePosting.post({
      kind: "chat",
      context,
      content: "atomic attachment",
      attachmentIds: [attachment.id],
    }),
    /p-a9 atomic attachment failure/,
  );
  assert.equal(db.select().from(schema.messages).where(eq(schema.messages.content, "atomic attachment")).get(), undefined);
  assert.equal(db.select().from(schema.attachments).where(eq(schema.attachments.id, attachment.id)).get()?.messageId, null);
  sqlite.exec("DROP TRIGGER p_a9_fail_atomic_attachment;");

  sqlite.exec(`
    CREATE TRIGGER p_a9_fail_atomic_task_audit
    BEFORE INSERT ON messages
    WHEN NEW.message_type = 'system' AND NEW.content LIKE '%created task%'
    BEGIN SELECT RAISE(ABORT, 'p-a9 atomic task audit failure'); END;
  `);
  await assert.rejects(
    modules().tasks.create({ context, title: "atomic task", executionMode: "autopilot" }),
    /p-a9 atomic task audit failure/,
  );
  assert.equal(db.select().from(schema.messages).where(eq(schema.messages.content, "atomic task")).get(), undefined);
  sqlite.exec("DROP TRIGGER p_a9_fail_atomic_task_audit;");

  const postCommitFailure = modules({
    async publish() { throw new Error("p-a9 post-commit event failure"); },
  });
  const committed = await postCommitFailure.messagePosting.post({
    kind: "chat",
    context,
    content: "post-commit survives",
  });
  assert.equal(
    db.select().from(schema.messages).where(eq(schema.messages.id, committed.id)).get()?.content,
    "post-commit survives",
  );
} finally {
  try {
    sqlite.exec(`
      DROP TRIGGER IF EXISTS p_a9_fail_atomic_chain;
      DROP TRIGGER IF EXISTS p_a9_fail_atomic_mention;
      DROP TRIGGER IF EXISTS p_a9_fail_atomic_attachment;
      DROP TRIGGER IF EXISTS p_a9_fail_atomic_task_audit;
    `);
  } catch { /* database may already be closed */ }
  closeAllDatabases();
}
