import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompt.js";

test("system prompt teaches the plan-first confirmation protocol and orchestration return mention", () => {
  const prompt = buildSystemPrompt({
    name: "leader",
    displayName: "Leader",
    agentId: "leader-id",
    spaceId: "space-id",
    hostname: "test-host",
    os: "test-os",
    workspace: "test-workspace",
    memory: {
      user: { root: "/memory/user", indexFile: "/memory/user/MEMORY.md", notesDir: "/memory/user/notes" },
      space: { root: "/memory/space", indexFile: "/memory/space/MEMORY.md", notesDir: "/memory/space/notes" },
      agent: { root: "/memory/agent", indexFile: "/memory/agent/MEMORY.md", notesDir: "/memory/agent/notes" },
    },
  });
  assert.match(prompt, /mode=autopilot/);
  assert.match(prompt, /mode=plan-first/);
  assert.match(prompt, /wait for a human to say “开始”/);
  assert.match(prompt, /do not @mention dev\/tester\/other agents/);
  assert.match(prompt, /do not run `task assign`/);
  assert.match(prompt, /delegated agents to @mention you when reporting/);
  assert.match(prompt, /soft guard/);
  assert.match(prompt, /Space ID: space-id/);
  assert.match(prompt, /kith-space space info/);
  assert.doesNotMatch(prompt, /kith-space server info|Server ID:/);
  const user = prompt.indexOf("/memory/user/MEMORY.md");
  const space = prompt.indexOf("/memory/space/MEMORY.md");
  const agent = prompt.indexOf("/memory/agent/MEMORY.md");
  assert.ok(user >= 0 && user < space && space < agent, "memory read guidance is user → space → agent");
  assert.match(prompt, /one durable topic per file/);
  assert.match(prompt, /update that layer's `MEMORY\.md` index in the same operation/);
  assert.match(prompt, /no memory read\/write MCP tool/);
});

test("Windows system prompt uses PowerShell-native commands instead of POSIX shell syntax", () => {
  const prompt = buildSystemPrompt({
    name: "windows-agent",
    displayName: "Windows Agent",
    agentId: "windows-id",
    spaceId: "space-id",
    hostname: "windows-host",
    os: "win32 x64",
    workspace: "C:\\Kith Space\\agent",
    memory: {
      user: { root: "C:\\memory\\user", indexFile: "C:\\memory\\user\\MEMORY.md", notesDir: "C:\\memory\\user\\notes" },
      space: { root: "C:\\memory\\space", indexFile: "C:\\memory\\space\\MEMORY.md", notesDir: "C:\\memory\\space\\notes" },
      agent: { root: "C:\\memory\\agent", indexFile: "C:\\memory\\agent\\MEMORY.md", notesDir: "C:\\memory\\agent\\notes" },
    },
  });

  assert.match(prompt, /Windows/);
  assert.match(prompt, /PowerShell/);
  assert.match(prompt, /kith-space\.cmd/);
  assert.match(prompt, /\$OutputEncoding/);
  assert.doesNotMatch(prompt, /shell\/bash tool/);
  assert.doesNotMatch(prompt, /```bash/);
  assert.doesNotMatch(prompt, /<<'MSG'/);
});

test("Linux system prompt keeps the POSIX CLI example", () => {
  const prompt = buildSystemPrompt({
    name: "linux-agent",
    displayName: "Linux Agent",
    agentId: "linux-id",
    spaceId: "space-id",
    hostname: "linux-host",
    os: "linux x64",
    workspace: "/home/kith/agent",
    memory: {
      user: { root: "/memory/user", indexFile: "/memory/user/MEMORY.md", notesDir: "/memory/user/notes" },
      space: { root: "/memory/space", indexFile: "/memory/space/MEMORY.md", notesDir: "/memory/space/notes" },
      agent: { root: "/memory/agent", indexFile: "/memory/agent/MEMORY.md", notesDir: "/memory/agent/notes" },
    },
  });

  assert.match(prompt, /POSIX/);
  assert.match(prompt, /```(?:sh|bash)/);
  assert.match(prompt, /<<'MSG'/);
});
