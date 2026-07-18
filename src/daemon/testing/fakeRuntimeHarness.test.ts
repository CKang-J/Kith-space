import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "../../log.js";
import type { RuntimeCallbacks, StartOpts } from "../runtime.js";
import { createFakeRuntimeHarness } from "./fakeRuntimeHarness.js";

function options(initialPrompt: string): StartOpts {
  return {
    cwd: "C:/workspace",
    systemPrompt: "system",
    env: {},
    initialPrompt,
  };
}

function callbacks(exits: Array<number | null>, trajectories: string[] = []): RuntimeCallbacks {
  return {
    onSession() {},
    onActivity() {},
    onTrajectory(entries) { trajectories.push(...entries.map((entry) => entry.text ?? "")); },
    onExit(code) { exits.push(code); },
    log: createLogger("fake-runtime-test"),
  };
}

test("fake Runtime harness records live sessions, delivery, stop, and exit facts", () => {
  const exits: Array<number | null> = [];
  const trajectories: string[] = [];
  const harness = createFakeRuntimeHarness();
  const first = harness.runtime.start(options("first"), callbacks(exits, trajectories));
  const second = harness.runtime.start(options("second"), callbacks(exits));

  first.deliver("follow-up");
  harness.trajectory("fake-session-1", [{ kind: "text", text: "progress" }]);
  assert.deepEqual(trajectories, ["progress"]);
  assert.deepEqual(harness.snapshot(), {
    totalStarts: 2,
    activeSessions: 2,
    peakActiveSessions: 2,
    totalDeliveries: 1,
    totalStops: 0,
    totalExits: 0,
  });
  assert.deepEqual(harness.sessions().map((session) => ({
    id: session.id,
    initialPrompt: session.start.initialPrompt,
    deliveries: session.deliveries,
    stopped: session.stopped,
    exitCode: session.exitCode,
  })), [
    { id: "fake-session-1", initialPrompt: "first", deliveries: ["follow-up"], stopped: false, exitCode: undefined },
    { id: "fake-session-2", initialPrompt: "second", deliveries: [], stopped: false, exitCode: undefined },
  ]);

  first.stop();
  first.stop();
  harness.exit("fake-session-2", 7);
  assert.deepEqual(exits, [0, 7]);
  assert.deepEqual(harness.snapshot(), {
    totalStarts: 2,
    activeSessions: 0,
    peakActiveSessions: 2,
    totalDeliveries: 1,
    totalStops: 1,
    totalExits: 2,
  });
});
