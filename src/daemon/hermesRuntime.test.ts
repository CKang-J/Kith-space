import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHermesArgs, buildHermesPrompt, hermesBridgeDecision, hermesProfile, hermesProfileHome, hermesRuntime, hermesRuntimeEnv, parseHermesSessionId, parseHermesTurnEvents, postHermesBridgeMessage } from "./hermesRuntime.js";
import { discoverHermesProfilesFromRoots } from "./listModels.js";

test("Hermes profile comes from runtimeConfig first, then model, then default", () => {
  assert.equal(hermesProfile("codex", { profile: "alpha-helper" }), "alpha-helper");
  assert.equal(hermesProfile("gemini", {}), "gemini");
  assert.equal(hermesProfile("default", {}), "default");
  assert.equal(hermesProfile(undefined, null), "default");
});

test("Hermes CLI args use quiet chat mode for Kith-space", () => {
  assert.deepEqual(buildHermesArgs("hello"), ["chat", "-q", "hello", "-Q", "--source", "kith-space"]);
});

test("Hermes CLI args resume the captured native Hermes session", () => {
  assert.deepEqual(buildHermesArgs("hello", "20260702_221211_1991f1"), ["chat", "-q", "hello", "-Q", "--source", "kith-space", "--resume", "20260702_221211_1991f1"]);
});

test("Hermes session id is parsed from quiet stderr", () => {
  assert.equal(parseHermesSessionId("noise\nsession_id: 20260702_221211_1991f1\n"), "20260702_221211_1991f1");
  assert.equal(parseHermesSessionId("session_id: old\nmore\nsession_id: new"), "new");
  assert.equal(parseHermesSessionId("Session not found: missing"), null);
});

test("Hermes prompt carries Kith-space system prompt, cwd, and user message", () => {
  const prompt = buildHermesPrompt("please help", { cwd: "/tmp/kith-space-agent", systemPrompt: "use kith-space cli" });
  assert.match(prompt, /isolated workspace: \/tmp\/kith-space-agent/);
  assert.match(prompt, /use kith-space cli/);
  assert.match(prompt, /please help/);
});

test("Hermes profile discovery reads profile dirs with default first, then alphabetical", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-hermes-"));
  try {
    mkdirSync(path.join(root, "zeta-helper"));
    writeFileSync(path.join(root, "zeta-helper", "SOUL.md"), "# Zeta\n");
    mkdirSync(path.join(root, "alpha-helper"));
    writeFileSync(path.join(root, "alpha-helper", "profile.yaml"), "display_name: Alpha Profile\n");
    mkdirSync(path.join(root, "misc-helper"));
    writeFileSync(path.join(root, "misc-helper", "config.yaml"), "name: Misc Helper\n");
    mkdirSync(path.join(root, "not-a-profile"));

    const profiles = discoverHermesProfilesFromRoots([root]);
    assert.deepEqual(profiles.map((p) => p.id), ["default", "alpha-helper", "misc-helper", "zeta-helper"]);
    assert.equal(profiles[0]?.label, "Default profile");
    assert.equal(profiles[0]?.default, true);
    assert.equal(profiles[1]?.label, "Alpha Profile");
    assert.equal(profiles[2]?.label, "Misc Helper");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes profile home resolves named profiles without changing global defaults", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-hermes-home-"));
  try {
    mkdirSync(path.join(root, ".hermes", "profiles", "alpha-helper"), { recursive: true });
    assert.equal(hermesProfileHome("alpha-helper", root), path.join(root, ".hermes", "profiles", "alpha-helper"));
    assert.equal(hermesProfileHome("missing", root), null);
    assert.equal(hermesProfileHome("default", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes runtime default profile clears inherited profile env", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-hermes-env-"));
  try {
    const inheritedHome = path.join(root, "old-home");
    const { env, profile } = hermesRuntimeEnv({ HERMES_HOME: inheritedHome, HERMES_PROFILE: "old-profile" }, root, "default", root);
    assert.equal(profile, "default");
    assert.equal(env.HERMES_HOME, undefined);
    assert.equal(env.HERMES_PROFILE, undefined);
    assert.equal(env.PWD, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes runtime resolves profiles from HERMES_PROFILE_DIR as well as ~/.hermes/profiles", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-hermes-profile-dir-"));
  try {
    const customProfiles = path.join(root, "custom-profiles");
    mkdirSync(path.join(customProfiles, "custom-helper"), { recursive: true });
    const { env, profile } = hermesRuntimeEnv({ HERMES_PROFILE_DIR: customProfiles }, root, "custom-helper", root);
    assert.equal(profile, "custom-helper");
    assert.equal(env.HERMES_HOME, path.join(customProfiles, "custom-helper"));
    assert.equal(env.HERMES_PROFILE, "custom-helper");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes removes the turn side-channel file when the CLI fails", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-hermes-turn-cleanup-"));
  const command = path.join(root, process.platform === "win32" ? "hermes.cmd" : "hermes");
  const previousPath = process.env.PATH;
  try {
    writeFileSync(command, process.platform === "win32"
      ? "@echo off\r\n> \"%KITH_SPACE_TURN_FILE%\" echo {\"type\":\"check\",\"target\":\"dm:@User\",\"count\":1}\r\nexit /b 1\r\n"
      : "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"check\",\"target\":\"dm:@User\",\"count\":1}' > \"$KITH_SPACE_TURN_FILE\"\nexit 1\n");
    if (process.platform !== "win32") chmodSync(command, 0o755);
    process.env.PATH = `${root}${path.delimiter}${previousPath ?? ""}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Hermes fixture did not exit")), 3_000);
      hermesRuntime.start({
        cwd: root,
        runtimeStateDir: root,
        systemPrompt: "test",
        env: { ...process.env },
        initialPrompt: "fail",
      }, {
        onSession() {},
        onActivity() {},
        onTrajectory() {},
        onExit() {
          clearTimeout(timer);
          resolve();
        },
        log: {
          debug() {}, info() {}, warn() {}, error() {},
          child() { return this; },
        },
      });
    });
    assert.deepEqual(readdirSync(root).filter((name) => name.startsWith("hermes-turn-")), []);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Hermes final response bridge requires check/read evidence and filters unsafe stdout", () => {
  const checked = parseHermesTurnEvents(JSON.stringify({ type: "check", target: "dm:@User", count: 1 }));
  assert.deepEqual(checked, { sent: false, held: false, engaged: true, target: "dm:@User" });
  assert.deepEqual(hermesBridgeDecision("⚠ scanner warning\n\nI handled that.", checked), {
    ok: true,
    target: "dm:@User",
    content: "I handled that.",
  });

  assert.deepEqual(hermesBridgeDecision("I handled that.", parseHermesTurnEvents("")), {
    ok: false,
    reason: "no-kith-space-read",
  });
  assert.equal(hermesBridgeDecision("Error: provider rejected the request", checked).ok, false);
  assert.equal(hermesBridgeDecision("┊ review diff\na/MEMORY.md → b/MEMORY.md\n@@ -1 +1", checked).ok, false);
});

test("Hermes final response bridge avoids double posting after explicit send or hold", () => {
  const sent = parseHermesTurnEvents([
    JSON.stringify({ type: "check", target: "dm:@User", count: 1 }),
    JSON.stringify({ type: "send", target: "dm:@User", seq: 12 }),
  ].join("\n"));
  assert.deepEqual(hermesBridgeDecision("Already sent.", sent), { ok: false, reason: "already-sent" });

  const held = parseHermesTurnEvents(JSON.stringify({ type: "held", target: "dm:@User" }));
  assert.deepEqual(hermesBridgeDecision("Freshness hold: showing latest 1 of 1 newer message.", held), { ok: false, reason: "already-held" });
});

test("Hermes bridge does not auto-submit a freshness-held draft", async () => {
  const calls: unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ held: true, draft: true }),
    } as Response;
  };

  const result = await postHermesBridgeMessage(fetchImpl, "http://server", { authorization: "Bearer t", "x-agent-id": "a", "content-type": "application/json" }, "dm:@User", "Final answer");

  assert.deepEqual(result, { ok: false, held: true, sentDraft: false });
  assert.deepEqual(calls, [
    { target: "dm:@User", content: "Final answer" },
  ]);
});
