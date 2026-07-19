import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs } from "../../daemon/claudeRuntime.js";
import { buildCodexAppServerArgs } from "../../daemon/codexRuntime.js";
import { buildOpencodeConfigContent } from "../../daemon/opencodeRuntime.js";
import { resolveRuntimeGatewayLaunch, verifyRuntimeGatewayLaunch } from "../worker/sessions/runtimeSessionPreparation.js";

const bootstrap = {
  mode: "config" as const,
  serverName: "kith-core",
  descriptor: {
    command: "/node",
    args: ["/kith-core-mcp.mjs"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    configFile: "/runtime/kith-core.json",
    capabilityMode: "mcp_with_cli_fallback",
  },
};

test("Claude, Codex and OpenCode inject the same kith-core stdio MCP launch", () => {
  const claude = buildClaudeArgs({ promptFileFlag: ["--append-system-prompt", "system"], mcpConfigFile: "/runtime/kith-core.json" });
  assert.deepEqual(claude.slice(-3), ["--mcp-config", "/runtime/kith-core.json", "--strict-mcp-config"]);

  const codex = buildCodexAppServerArgs(bootstrap);
  assert.ok(codex.includes("mcp_servers.kith-core.command=\"/node\""));
  assert.ok(codex.includes("mcp_servers.kith-core.args=[\"/kith-core-mcp.mjs\"]"));
  assert.ok(codex.includes("mcp_servers.kith-core.env.ELECTRON_RUN_AS_NODE=\"1\""));

  const opencode = JSON.parse(buildOpencodeConfigContent("system", undefined, bootstrap));
  assert.deepEqual(opencode.mcp["kith-core"], {
    type: "local", command: ["/node", "/kith-core-mcp.mjs"], environment: { ELECTRON_RUN_AS_NODE: "1" }, enabled: true,
  });
});

test("Gateway bootstrap degrades only to an executable CLI and fails closed when both paths are missing", () => {
  const common = { here: "/app/runtime", runtimeStateDir: "/state", sessionId: "session-1", platform: "linux" as const };
  const cliOnly = resolveRuntimeGatewayLaunch({
    ...common,
    exists: (candidate) => candidate.endsWith("/node_modules/.bin/tsx") || candidate.endsWith("/src/cli/index.ts"),
  });
  assert.equal(cliOnly.capabilityMode, "cli_only");
  assert.equal(cliOnly.mcpBootstrap.mode, "none");

  const mcpOnly = resolveRuntimeGatewayLaunch({
    ...common,
    exists: (candidate) => candidate.endsWith("/kith-core-mcp.mjs"),
  });
  assert.equal(mcpOnly.capabilityMode, "mcp_only");
  assert.equal(mcpOnly.mcpBootstrap.mode, "config");

  assert.throws(() => resolveRuntimeGatewayLaunch({ ...common, exists: () => false }), /capability_gateway_unavailable/);
});

test("MCP handshake failure records CLI-only degradation and fails closed without the CLI", async () => {
  const withCli = { ...bootstrap, capabilityMode: "mcp_with_cli_fallback" as const, cliAvailable: true, mcpBootstrap: bootstrap };
  const degraded = await verifyRuntimeGatewayLaunch(withCli, async () => { throw new Error("stdio exited"); });
  assert.equal(degraded.capabilityMode, "cli_only");
  assert.equal(degraded.mcpBootstrap.mode, "none");
  assert.equal(degraded.mcpBootstrap.descriptor.bootstrapError, "mcp_bootstrap_failed");

  const withoutCli = { ...withCli, capabilityMode: "mcp_only" as const, cliAvailable: false };
  await assert.rejects(() => verifyRuntimeGatewayLaunch(withoutCli, async () => { throw new Error("stdio exited"); }), /mcp_bootstrap_failed/);
});
