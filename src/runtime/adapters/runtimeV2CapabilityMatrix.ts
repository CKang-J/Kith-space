import type { RuntimeCapabilities } from "../contract/v2/runtimeContract.js";
import { claudeRuntimeV2, codexRuntimeV2, opencodeRuntimeV2 } from "./runtimeV2Bridge.js";

export type RuntimeV2Support = "observed_v2" | "unsupported";

export interface RuntimeV2CapabilityReport {
  adapterVersion: string;
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
  mcpBootstrap: "unsupported" as const,
  toolIsolation: "unsupported" as const,
  cwdRelocation: "unsupported" as const,
  compactionTelemetry: "unsupported" as const,
};

/** P-A10.1 bridge facts. Unsupported capabilities must remain unavailable, never prompt-emulated. */
export const RUNTIME_V2_CAPABILITY_MATRIX: Record<"claude" | "codex" | "opencode", RuntimeV2CapabilityReport> = {
  claude: {
    adapterVersion: "v2-bridge-1",
    capabilities: claudeRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      ...commonUnsupported,
    },
  },
  codex: {
    adapterVersion: "v2-bridge-1",
    capabilities: codexRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      ...commonUnsupported,
    },
  },
  opencode: {
    adapterVersion: "v2-bridge-1",
    capabilities: opencodeRuntimeV2.capabilities,
    support: {
      resume: "observed_v2",
      sessionChanged: "observed_v2",
      usage: "observed_v2",
      completion: "observed_v2",
      cancel: "observed_v2",
      ...commonUnsupported,
    },
  },
};
