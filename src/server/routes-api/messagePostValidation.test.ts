import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { closeSpaceDb, registerSpace, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import type { SpaceCtx } from "./ctx.js";
import { handleMessages } from "./messages.js";
import {
  CANVAS_TASK_FORBIDDEN,
  EXECUTION_BINDING_REQUIRES_CANVAS,
  HUMAN_MESSAGE_CONTENT_REQUIRED,
  TASK_EXECUTION_MODE_REQUIRED,
  validateHumanMessagePost,
} from "./messagePostValidation.js";

function postMessages(spaceId: string, body: Record<string, unknown>) {
  const stream = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  (stream as { method?: string; headers?: Record<string, string> }).method = "POST";
  (stream as { headers?: Record<string, string> }).headers = {};
  const capture: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) { capture.status = status; return this; },
    end(payload?: string) { capture.body = payload; return this; },
  } as unknown as ServerResponse;
  const url = new URL("http://localhost/api/messages");
  return handleMessages({
    req: stream,
    res,
    url,
    method: "POST",
    p: "/api/messages",
    humanId: "human",
    spaceId,
  } satisfies SpaceCtx).then(() => ({
    status: capture.status,
    body: JSON.parse(capture.body ?? "{}") as { error?: string },
  }));
}

test("asTask with an illegal executionMode is rejected before Core can default to autopilot", () => {
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    content: "do it",
    asTask: true,
    executionMode: "banana",
  }), TASK_EXECUTION_MODE_REQUIRED);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    content: "do it",
    asTask: true,
    taskExecutionMode: "plan-first",
  }), null);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    content: "do it",
    asTask: true,
  }), null);
});

test("Canvas selection or list is valid message content without text or attachments", () => {
  assert.equal(validateHumanMessagePost({ channelId: "ch-1" }), HUMAN_MESSAGE_CONTENT_REQUIRED);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    canvasSelection: { canvasId: "c1", selectedIds: ["n1"] },
  }), null);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    canvasSelections: [{ canvasId: "c1", selectedIds: ["n1"] }],
  }), null);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    content: "look",
    canvasSelections: [{ canvasId: "c1", selectedIds: ["n1"] }],
    asTask: true,
  }), CANVAS_TASK_FORBIDDEN);
});

test("executionBinding without canvas selection is rejected, and the reverse illegal combo is clear", () => {
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    content: "look",
    executionBinding: { executorAgentId: "agent-1", mode: "required" },
  }), EXECUTION_BINDING_REQUIRES_CANVAS);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    asTask: true,
    content: "do it",
    executionBinding: { executorAgentId: "agent-1", mode: "required" },
  }), EXECUTION_BINDING_REQUIRES_CANVAS);
  assert.equal(validateHumanMessagePost({
    channelId: "ch-1",
    canvasSelection: { canvasId: "c1", selectedIds: ["n1"] },
    executionBinding: { executorAgentId: "agent-1", mode: "required" },
  }), null);
});

test("POST /api/messages returns 400 for illegal task mode, canvas-less binding, and empty body", async () => {
  const spaceId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Message Post Validation",
    slug: `message-post-${spaceId.slice(0, 8)}`,
    rootPath: path.join(kithSpaceHome(), "message-post", spaceId),
  });
  try {
    const illegalMode = await postMessages(spaceId, {
      channelId: "ch-1",
      content: "do it",
      asTask: true,
      executionMode: "banana",
    });
    assert.equal(illegalMode.status, 400);
    assert.equal(illegalMode.body.error, TASK_EXECUTION_MODE_REQUIRED);

    const bindingOnly = await postMessages(spaceId, {
      channelId: "ch-1",
      content: "look",
      executionBinding: { executorAgentId: "agent-1", mode: "required" },
    });
    assert.equal(bindingOnly.status, 400);
    assert.equal(bindingOnly.body.error, EXECUTION_BINDING_REQUIRES_CANVAS);

    const empty = await postMessages(spaceId, { channelId: "ch-1" });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, HUMAN_MESSAGE_CONTENT_REQUIRED);

    const canvasTask = await postMessages(spaceId, {
      channelId: "ch-1",
      canvasSelection: { canvasId: "c1", selectedIds: ["n1"] },
      asTask: true,
    });
    assert.equal(canvasTask.status, 400);
    assert.equal(canvasTask.body.error, CANVAS_TASK_FORBIDDEN);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
