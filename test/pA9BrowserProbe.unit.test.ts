import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("P-A9 browser probe has a syntax-valid repeatable measurement interface", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../scripts/p-a9/chat-browser-probe.js"), "utf8");
  new Function(source)();
  const probe = (globalThis as typeof globalThis & {
    pA9BrowserProbe?: Record<string, unknown>;
  }).pA9BrowserProbe;
  assert.ok(probe);
  assert.deepEqual(Object.keys(probe), [
    "armRender",
    "readRender",
    "renderRound",
    "armRealtime",
    "readRealtime",
    "loadHistory",
    "scrollRound",
    "cleanup",
  ]);
  delete (globalThis as typeof globalThis & { pA9BrowserProbe?: Record<string, unknown> }).pA9BrowserProbe;
});

test("Vite reuses its Core proxy connection during repeated browser rounds", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../web/vite.config.ts"), "utf8");
  assert.match(source, /new Agent\(\{ keepAlive: true \}\)/);
  assert.match(source, /"\/api": \{ target: API, changeOrigin: false, agent: coreProxyAgent \}/);
  assert.match(source, /"\/socket\.io": \{ target: API, ws: true, changeOrigin: false \}/);
});
