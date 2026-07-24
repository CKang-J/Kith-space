import type { RuntimeCapabilities } from "./runtimeContract.js";

export type RuntimeCapabilitySupport = "observed_v1" | "missing" | "unsupported";

export interface RuntimeV1CapabilityBaseline {
  processModel: "persistent" | "one_shot";
  capabilities: RuntimeCapabilities;
  support: {
    resume: RuntimeCapabilitySupport;
    sessionChanged: RuntimeCapabilitySupport;
    usage: RuntimeCapabilitySupport;
    completion: RuntimeCapabilitySupport;
    cancel: RuntimeCapabilitySupport;
    mcpBootstrap: RuntimeCapabilitySupport;
    toolIsolation: RuntimeCapabilitySupport;
    cwdRelocation: RuntimeCapabilitySupport;
  };
}

const noHooks = {
  beforeTool: false,
  afterTool: false,
  beforeCompact: false,
  afterCompact: false,
  stopFinalize: false,
};

/**
 * Honest P-A10.0 baseline. These values describe the pre-v2 adapters and must
 * not be interpreted as the P-A10.1 target capability matrix.
 */
export const RUNTIME_V1_CAPABILITY_BASELINE: Record<"claude" | "codex" | "opencode", RuntimeV1CapabilityBaseline> = {
  claude: {
    processModel: "persistent",
    capabilities: {
      resumableSession: true,
      persistentProcess: true,
      mcp: "none",
      hooks: noHooks,
      usage: "none",
      cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false,
      toolIsolation: "none",
    },
    support: {
      resume: "missing",
      sessionChanged: "missing",
      usage: "missing",
      completion: "missing",
      cancel: "missing",
      mcpBootstrap: "missing",
      toolIsolation: "unsupported",
      cwdRelocation: "unsupported",
    },
  },
  codex: {
    processModel: "persistent",
    capabilities: {
      resumableSession: true,
      persistentProcess: true,
      mcp: "none",
      hooks: noHooks,
      usage: "none",
      cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false,
      toolIsolation: "none",
    },
    support: {
      resume: "missing",
      sessionChanged: "missing",
      usage: "missing",
      completion: "missing",
      cancel: "missing",
      mcpBootstrap: "missing",
      toolIsolation: "unsupported",
      cwdRelocation: "unsupported",
    },
  },
  opencode: {
    processModel: "one_shot",
    capabilities: {
      resumableSession: true,
      persistentProcess: false,
      mcp: "none",
      hooks: noHooks,
      usage: "none",
      cancellation: "process",
      context: { modelWindow: "unknown", tokenEstimator: "approximate" },
      cwdRelocatableResume: false,
      toolIsolation: "none",
    },
    support: {
      resume: "missing",
      sessionChanged: "missing",
      usage: "missing",
      completion: "missing",
      cancel: "missing",
      mcpBootstrap: "missing",
      toolIsolation: "unsupported",
      cwdRelocation: "unsupported",
    },
  },
};
