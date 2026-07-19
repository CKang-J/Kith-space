import assert from "node:assert/strict";
import test from "node:test";
import { TurnCapabilityClaimsSchema } from "../capabilities/contracts.js";
import { ContextEnvelopeSchema } from "../context/contracts.js";
import { AgentDeliveryItemSchema } from "../deliveries/contracts.js";
import { EpisodicMemorySchema, MemoryMutationCommandSchema } from "../memory/contracts.js";
import { TurnCedeCommandSchema, TurnReplyCommandSchema } from "../turns/contracts.js";
import { HARNESS_ERROR_CODES } from "./errors.js";

test("P-A10.0 freezes strict harness command and error-code boundaries", () => {
  assert.ok(HARNESS_ERROR_CODES.includes("stale_context"));
  assert.ok(HARNESS_ERROR_CODES.includes("idempotency_conflict"));
  assert.ok(HARNESS_ERROR_CODES.includes("output_missing"));
  assert.throws(() => TurnReplyCommandSchema.parse({
    schemaVersion: 1,
    body: "reply",
    handledInputIds: [],
    operationKey: "reply:primary",
  }));
  assert.throws(() => TurnCedeCommandSchema.parse({
    schemaVersion: 1,
    inputIds: [],
    reason: "nothing to add",
    operationKey: "cede:primary",
  }));
  assert.throws(() => MemoryMutationCommandSchema.parse({
    schemaVersion: 1,
    action: "archive",
    memoryId: "memory-1",
    expectedRevision: 0,
    idempotencyKey: "archive:1",
  }));
});

test("P-A10.0 contract codecs remain independently importable by future modules", () => {
  for (const schema of [
    AgentDeliveryItemSchema,
    ContextEnvelopeSchema,
    TurnCapabilityClaimsSchema,
    EpisodicMemorySchema,
  ]) assert.equal(typeof schema.safeParse, "function");
});
