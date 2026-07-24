import assert from "node:assert/strict";
import test from "node:test";
import { hasWorkerAdmissionIdentity } from "./runtimeWorkerPort.js";

test("turn admissions use their command id as the Worker admission identity", () => {
  assert.equal(hasWorkerAdmissionIdentity({
    type: "agent:turn:admit",
    source: "turn",
    generation: 3,
    commandId: "attempt-1",
  }), true);
  assert.equal(hasWorkerAdmissionIdentity({
    type: "agent:turn:admit",
    source: "turn",
    generation: 3,
  }), false);
});

test("wake admissions still require a delivery id", () => {
  assert.equal(hasWorkerAdmissionIdentity({
    type: "agent:deliver",
    source: "wake",
    generation: 3,
    deliveryId: "delivery-1",
  }), true);
  assert.equal(hasWorkerAdmissionIdentity({
    type: "agent:deliver",
    source: "wake",
    generation: 3,
    commandId: "wrong-id-kind",
  }), false);
});
