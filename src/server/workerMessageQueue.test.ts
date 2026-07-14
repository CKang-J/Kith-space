import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerMessageQueue } from "./workerMessageQueue.js";

test("worker messages stay ordered across asynchronous handlers", async () => {
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const enqueue = createWorkerMessageQueue(async (message: string) => {
    order.push(`${message}:start`);
    if (message === "trajectory") await firstGate;
    order.push(`${message}:end`);
  }, (error) => { throw error; });

  const trajectory = enqueue("trajectory");
  const boundary = enqueue("boundary");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["trajectory:start"]);

  releaseFirst();
  await Promise.all([trajectory, boundary]);
  assert.deepEqual(order, ["trajectory:start", "trajectory:end", "boundary:start", "boundary:end"]);
});

test("one failed worker message does not block the following message", async () => {
  const handled: string[] = [];
  const errors: string[] = [];
  const enqueue = createWorkerMessageQueue(async (message: string) => {
    if (message === "bad") throw new Error("bad message");
    handled.push(message);
  }, (error) => errors.push(String(error)));

  await enqueue("bad");
  await enqueue("good");

  assert.equal(errors.length, 1);
  assert.deepEqual(handled, ["good"]);
});
