import path from "node:path";
import type { ActivatedAdvisorCredential } from "../runtime/contract/advisorProviderRuntimePort.js";

const HOST_ONLY_ENV = new Set([
  "ENV_FILE",
  "PORT",
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
  "NODE_PATH",
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

/** Maintenance completions inherit provider credentials, but never Core/Worker or per-Agent capabilities. */
export function buildMaintenanceProcessEnv(source: Readonly<NodeJS.ProcessEnv> = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (!isHostOnlyEnv(name)) env[name] = value;
  }
  env.FORCE_COLOR = "0";
  return env;
}

/** Provider-v1 never inherits ambient auth/profile/config. */
export function buildRestrictedProviderEnv(home: string, credential?: ActivatedAdvisorCredential, baseUrl?: string): NodeJS.ProcessEnv {
  return {
    FORCE_COLOR: "0",
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    ...(process.platform === "win32" ? {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ComSpec: process.env.ComSpec,
    } : {}),
    ...(credential?.type === "api_key" ? { ANTHROPIC_API_KEY: credential.value } : {}),
    ...(credential?.type === "oauth" ? { CLAUDE_CODE_OAUTH_TOKEN: credential.value } : {}),
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
