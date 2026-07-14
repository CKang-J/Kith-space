import test from "node:test";
import assert from "node:assert/strict";
import {
  TrajectoryScopeTracker,
  mergeTrajectoryScopes,
  trajectoryScopeForDeliveries,
  trajectoryScopeForDelivery,
} from "./trajectoryScope.js";

test("one delivery creates an explicit channel trajectory scope", () => {
  assert.deepEqual(trajectoryScopeForDelivery("channel-a", "stream-1"), {
    kind: "scoped",
    channelId: "channel-a",
    streamId: "stream-1",
  });
});

test("deliveries for one target stay scoped and keep the latest stream", () => {
  assert.deepEqual(trajectoryScopeForDeliveries([
    { target: "channel-a", streamId: "stream-1" },
    { target: "channel-a", streamId: "stream-2" },
  ]), { kind: "scoped", channelId: "channel-a", streamId: "stream-2" });
});

test("mixed or partly unscoped delivery batches are ambiguous", () => {
  assert.deepEqual(mergeTrajectoryScopes(
    trajectoryScopeForDelivery("channel-a"),
    trajectoryScopeForDelivery("channel-b"),
  ), { kind: "ambiguous" });
  assert.deepEqual(trajectoryScopeForDeliveries([
    { target: "channel-a" },
    { target: "" },
  ]), { kind: "ambiguous" });
});

test("tracker keeps a terminal boundary on the active turn before advancing the queue", () => {
  const tracker = new TrajectoryScopeTracker(trajectoryScopeForDelivery("channel-a", "stream-a"));
  tracker.schedule(trajectoryScopeForDelivery("channel-b", "stream-b"));

  assert.deepEqual(tracker.current(), { kind: "scoped", channelId: "channel-a", streamId: "stream-a" });
  assert.deepEqual(tracker.finishTurn(), { kind: "scoped", channelId: "channel-a", streamId: "stream-a" });
  assert.deepEqual(tracker.beginTurn(), { kind: "scoped", channelId: "channel-b", streamId: "stream-b" });
});

test("a delivery scheduled between turns cannot jump ahead of an already queued turn", () => {
  const tracker = new TrajectoryScopeTracker(trajectoryScopeForDelivery("channel-a"));
  tracker.schedule(trajectoryScopeForDelivery("channel-b"));
  tracker.finishTurn();
  tracker.schedule(trajectoryScopeForDelivery("channel-c"));

  assert.deepEqual(tracker.beginTurn(), { kind: "scoped", channelId: "channel-b" });
  tracker.finishTurn();
  assert.deepEqual(tracker.beginTurn(), { kind: "scoped", channelId: "channel-c" });
});

test("a failed delivery can roll back only its own scheduled scope", () => {
  const tracker = new TrajectoryScopeTracker();
  const failed = tracker.schedule(trajectoryScopeForDelivery("channel-a"));

  assert.equal(tracker.rollback(failed), true);
  assert.deepEqual(tracker.current(), { kind: "unscoped" });

  const accepted = tracker.schedule(trajectoryScopeForDelivery("channel-b"));
  assert.equal(tracker.rollback(failed), false);
  assert.deepEqual(tracker.beginTurn(), { kind: "unscoped" });
  tracker.finishTurn();
  assert.deepEqual(tracker.beginTurn(), { kind: "scoped", channelId: "channel-b" });
  assert.equal(tracker.rollback(accepted), false);
});
