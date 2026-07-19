import assert from "node:assert/strict";
import test from "node:test";
import { buildMaintenanceProcessEnv } from "../../../daemon/agentProcessEnv.js";
import { WorkerMaintenanceRuntimePort } from "../../control/maintenanceRuntimeAdapter.js";
import { buildClaudeMaintenanceArgs } from "./claudeMaintenanceRuntime.js";

test("Claude maintenance arguments enforce no tools, no MCP, no persistence, and safe-mode context", () => {
  const args = buildClaudeMaintenanceArgs(null);
  const tools = args.indexOf("--tools");
  const mcp = args.indexOf("--mcp-config");
  assert.equal(args[tools + 1], "");
  assert.equal(args[mcp + 1], JSON.stringify({ mcpServers: {} }));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--safe-mode"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(!args.includes("--bare"), "bare would disable the user's normal Claude OAuth/keychain authentication");
  assert.ok(!args.includes("--resume"));
});

test("maintenance environment keeps provider credentials but strips every Kith capability", () => {
  const env = buildMaintenanceProcessEnv({
    PATH: "/bin",
    ANTHROPIC_API_KEY: "provider",
    KITH_SPACE_AGENT_TOKEN: "agent-secret",
    KITH_SPACE_WORKER_TOKEN: "worker-secret",
    CLAUDECODE: "nested",
  });
  assert.equal(env.ANTHROPIC_API_KEY, "provider");
  assert.equal(env.KITH_SPACE_AGENT_TOKEN, undefined);
  assert.equal(env.KITH_SPACE_WORKER_TOKEN, undefined);
  assert.equal(env.CLAUDECODE, undefined);
});

test("maintenance support is honest and does not inherit ordinary runtime capabilities", () => {
  const port = new WorkerMaintenanceRuntimePort();
  assert.equal(port.support("claude").toolIsolation, "enforced");
  assert.equal(port.support("codex").toolIsolation, "unsupported");
  assert.equal(port.support("opencode").toolIsolation, "unsupported");
});
