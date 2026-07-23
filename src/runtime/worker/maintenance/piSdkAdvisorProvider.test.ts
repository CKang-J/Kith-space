import assert from "node:assert/strict";
import test from "node:test";
import { parsePiAdvisorEnvelope, piAdvisorSystemInstruction } from "./piSdkAdvisorProvider.js";

test("Pi Advisor supplies the complete bounded memory schema to the model", () => {
  const instruction = piAdvisorSystemInstruction();
  assert.match(instruction, /memory_advisor_v1/);
  assert.match(instruction, /"schemaVersion"/);
  assert.match(instruction, /"evidenceSourceIds"/);
  assert.match(instruction, /"additionalProperties":false/);
});

test("Pi Advisor classifies malformed or schema-invalid helper output as invalid output", () => {
  assert.throws(() => parsePiAdvisorEnvelope(JSON.stringify({ ok: true, output: "not-json" })), /provider_invalid_output/);
  assert.throws(() => parsePiAdvisorEnvelope(JSON.stringify({ ok: true, output: "{}" })), /provider_invalid_output/);
  assert.throws(() => parsePiAdvisorEnvelope(JSON.stringify({ ok: false, errorCode: "provider_auth_required" })), /provider_auth_required/);
});
