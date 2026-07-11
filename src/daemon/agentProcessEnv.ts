import path from "node:path";

const HOST_ONLY_ENV = new Set([
  "ENV_FILE",
  "PORT",
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
  "ELECTRON_RUN_AS_NODE",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
]);

function isHostOnlyEnv(name: string): boolean {
  const normalized = name.toUpperCase();
  return normalized.startsWith("KITH_SPACE_") || HOST_ONLY_ENV.has(normalized);
}

/** Agent runtimes receive provider access and one per-agent capability, never host capabilities. */
export function buildAgentProcessEnv(input: {
  source?: Readonly<NodeJS.ProcessEnv>;
  binDir: string;
  serverUrl: string;
  agentId: string;
  agentToken: string;
}): NodeJS.ProcessEnv {
  const source = input.source ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  const sourcePath = Object.entries(source).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
  for (const [name, value] of Object.entries(source)) {
    if (name.toUpperCase() !== "PATH" && !isHostOnlyEnv(name)) env[name] = value;
  }
  env.FORCE_COLOR = "0";
  env.PATH = `${input.binDir}${path.delimiter}${sourcePath}`;
  env.KITH_SPACE_SERVER_URL = input.serverUrl;
  env.KITH_SPACE_AGENT_ID = input.agentId;
  env.KITH_SPACE_AGENT_TOKEN = input.agentToken;
  return env;
}
