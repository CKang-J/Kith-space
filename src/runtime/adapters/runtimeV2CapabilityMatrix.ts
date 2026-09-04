import type { RuntimeCapabilities } from "../contract/v2/runtimeContract.js";
import { claudeRuntimeV2, codexRuntimeV2, opencodeRuntimeV2 } from "./runtimeV2Bridge.js";
import { piRpcRuntimeV2 } from "./piRpcRuntimeV2.js";
import { piBuiltinRpcRuntimeV2 } from "./piBuiltinRpcRuntimeV2.js";

export type RuntimeV2Support = "fixture_v2" | "observed_v2" | "unsupported";

export interface RuntimeV2CapabilityReport {
  adapterVersion: string;
  capabilityMode: "mcp_with_cli_fallback" | "cli_gateway";
  capabilities: RuntimeCapabilities;
  support: {
    resume: RuntimeV2Support;
    sessionChanged: RuntimeV2Support;
    usage: RuntimeV2Support;
    completion: RuntimeV2Support;
    cancel: RuntimeV2Support;
    mcpBootstrap: RuntimeV2Support;
    toolIsolation: RuntimeV2Support;
    cwdRelocation: RuntimeV2Support;
    compactionTelemetry: RuntimeV2Support;
  };
}

const commonUnsupported = {
  toolIsolation: "unsupported" as const,
  cwdRelocation: "unsupported" as const,
  compactionTelemetry: "unsupported" as const,
};

/** P-A10.1 bridge facts. Unsupported capabilities must remain unavailable, never prompt-emulated. */
export const RUNTIME_V2_CAPABILITY_MATRIX: Record<"claude" | "codex" | "opencode" | "pi" | "pi-builtin", RuntimeV2CapabilityReport> = {
  claude: {
    adapterVersion: "v2-bridge-2",
    capabilityMode: "mcp_with_cli_fallback",
    capabilities: claudeRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      mcpBootstrap: "fixture_v2",
      ...commonUnsupported,
    },
  },
  codex: {
    adapterVersion: "v2-bridge-2",
    capabilityMode: "mcp_with_cli_fallback",
    capabilities: codexRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      mcpBootstrap: "fixture_v2",
      ...commonUnsupported,
      compactionTelemetry: "fixture_v2",
    },
  },
  opencode: {
    adapterVersion: "v2-bridge-2",
    capabilityMode: "mcp_with_cli_fallback",
    capabilities: opencodeRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      mcpBootstrap: "fixture_v2",
      ...commonUnsupported,
    },
  },
  pi: {
    adapterVersion: "pi-rpc-v1",
    capabilityMode: "cli_gateway",
    capabilities: piRpcRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      mcpBootstrap: "unsupported",
      toolIsolation: "unsupported",
      cwdRelocation: "unsupported",
      compactionTelemetry: "observed_v2",
    },
  },
  "pi-builtin": {
    adapterVersion: "pi-builtin-rpc-v1",
    capabilityMode: "cli_gateway",
    capabilities: piBuiltinRpcRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      mcpBootstrap: "unsupported",
      toolIsolation: "unsupported",
      cwdRelocation: "unsupported",
      compactionTelemetry: "observed_v2",
    },
  },
};
