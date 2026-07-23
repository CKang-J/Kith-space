import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildAgentProcessEnv } from "./agentProcessEnv.js";

test("agent runtime env preserves provider access but strips every host capability", () => {
  const env = buildAgentProcessEnv({
    source: {
      Path: "provider-bin",
      OPENAI_API_KEY: "provider-key",
      KITH_SPACE_DESKTOP_TOKEN: "desktop-secret",
      kith_space_worker_token: "worker-secret",
      KITH_SPACE_DESKTOP_MANAGED: "1",
      KITH_SPACE_HOME: "private-home",
      KITH_SPACE_AGENT_TOKEN: "another-agent",
      KITH_SPACE_DESKTOP_SMOKE_EXIT_MS: "1",
      ENV_FILE: ".env",
      PORT: "7777",
      NODE_CHANNEL_FD: "3",
      NODE_PATH: "private-host-modules",
      CLAUDECODE: "1",
    },
    binDir: "agent-bin",
    serverUrl: "http://127.0.0.1:7777",
    agentId: "agent-1",
    agentToken: "current-agent-token",
  });

  assert.equal(env.OPENAI_API_KEY, "provider-key");
  assert.equal(env.PATH, `agent-bin${path.delimiter}provider-bin`);
  assert.equal(env.Path, undefined);
  assert.equal(env.KITH_SPACE_SERVER_URL, "http://127.0.0.1:7777");
  assert.equal(env.KITH_SPACE_AGENT_ID, "agent-1");
  assert.equal(env.KITH_SPACE_AGENT_TOKEN, "current-agent-token");
  for (const name of [
    "KITH_SPACE_DESKTOP_TOKEN",
    "kith_space_worker_token",
    "KITH_SPACE_DESKTOP_MANAGED",
    "KITH_SPACE_HOME",
    "KITH_SPACE_DESKTOP_SMOKE_EXIT_MS",
    "ENV_FILE",
    "PORT",
    "NODE_CHANNEL_FD",
    "NODE_PATH",
    "CLAUDECODE",
  ]) assert.equal(env[name], undefined, `${name} must not reach an agent runtime`);
});

test("managed runtime env strips every ambient provider credential before compiler activation", () => {
  const env = buildAgentProcessEnv({
    source: {
      PATH: "provider-bin",
      OPENAI_API_KEY: "openai",
      ANTHROPIC_AUTH_TOKEN: "anthropic",
      AWS_SECRET_ACCESS_KEY: "aws",
      CUSTOM_BEARER_TOKEN: "custom",
      LANG: "en_US.UTF-8",
    },
    binDir: "agent-bin",
    serverUrl: "http://127.0.0.1:7777",
    agentId: "agent-1",
    agentToken: "agent-token",
    managedConfiguration: true,
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.CUSTOM_BEARER_TOKEN, undefined);
  assert.equal(env.LANG, "en_US.UTF-8");
});
