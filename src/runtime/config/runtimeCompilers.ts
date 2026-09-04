import path from "node:path";
import { BaseRuntimeConfigCompiler, type ActivatedRuntimeCredential, type RuntimeConfigurationCapabilities, type RuntimeConfigurationInput } from "./runtimeConfigCompiler.js";

const base = (supportedApiKinds: readonly string[], mcpBootstrap: "supported" | "unsupported" = "supported"): RuntimeConfigurationCapabilities => ({
  managedConfiguration: true, unmanagedCliNative: true, supportedApiKinds, mcpBootstrap,
});

function supported(input: RuntimeConfigurationInput, apiKinds: readonly string[]) {
  return apiKinds.includes(input.apiKind) ? { valid: true } : { valid: false, reason: `wire_api_${input.apiKind}_not_supported` };
}

export class ClaudeRuntimeConfigCompiler extends BaseRuntimeConfigCompiler {
  readonly runtimeId = "claude";
  private readonly apiKinds = ["anthropic-messages", "google-vertex", "bedrock-converse-stream"];
  describeCapabilities() { return base(this.apiKinds); }
  validate(input: RuntimeConfigurationInput) { return supported(input, this.apiKinds); }
  async compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null) {
    this.requireValid(input);
    const credential = this.credential(activation);
    const root = await this.privateRoot(input, "claude-home");
    const settings = await this.privateFile(root, "settings.json", "{}\n");
    return this.result(input, activation, {
      args: ["--settings", settings.path, "--setting-sources", ""],
      env: {
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: path.join(root, ".config"),
        ANTHROPIC_BASE_URL: input.canonicalOrigin,
        ...(credential ? { ANTHROPIC_API_KEY: credential } : {}),
      },
      files: [settings],
      cleanupRoot: root,
    });
  }
}

export class CodexRuntimeConfigCompiler extends BaseRuntimeConfigCompiler {
  readonly runtimeId = "codex";
  private readonly apiKinds = ["openai-responses", "openai-codex-responses"];
  describeCapabilities() { return base(this.apiKinds); }
  validate(input: RuntimeConfigurationInput) { return supported(input, this.apiKinds); }
  async compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null) {
    this.requireValid(input);
    const credential = this.credential(activation);
    const root = await this.privateRoot(input, "codex-home");
    const config = [
      `model = ${JSON.stringify(input.modelId)}`,
      `model_provider = "kith"`,
      `[model_providers.kith]`,
      `name = "Kith managed"`,
      `base_url = ${JSON.stringify(input.canonicalOrigin)}`,
      ...(credential ? [`env_key = "KITH_CODEX_API_KEY"`] : []),
      `wire_api = "responses"`,
    ].join("\n");
    const file = await this.privateFile(root, "config.toml", `${config}\n`);
    return this.result(input, activation, {
      args: [], env: { CODEX_HOME: root, ...(credential ? { KITH_CODEX_API_KEY: credential } : {}) },
      files: [file], cleanupRoot: root,
    });
  }
}

export class OpenCodeRuntimeConfigCompiler extends BaseRuntimeConfigCompiler {
  readonly runtimeId = "opencode";
  private readonly apiKinds = ["anthropic-messages", "openai-responses", "openai-completions", "google-generative-ai", "google-vertex"];
  describeCapabilities() { return base(this.apiKinds); }
  validate(input: RuntimeConfigurationInput) { return supported(input, this.apiKinds); }
  async compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null) {
    this.requireValid(input);
    const credential = this.credential(activation);
    const providerId = "kith";
    const root = await this.privateRoot(input, "opencode-agent");
    const compiled = this.result(input, activation, {
      args: [],
      env: {
        ...(credential ? { KITH_OPENCODE_API_KEY: credential } : {}),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
        OPENCODE_CONFIG_DIR: path.join(root, "config", "opencode"),
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_DISABLE_CLAUDE_CODE: "true",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider: { [providerId]: { npm: "@ai-sdk/openai-compatible", name: "Kith managed",
            options: { baseURL: input.canonicalOrigin, ...(credential ? { apiKey: "{env:KITH_OPENCODE_API_KEY}" } : {}) },
            models: { [input.modelId]: { name: input.modelId } } } },
          model: `${providerId}/${input.modelId}`,
        }),
      },
      cleanupRoot: root,
    });
    return { ...compiled, effectiveModelId: `${providerId}/${input.modelId}` };
  }
}

export class PiRuntimeConfigCompiler extends BaseRuntimeConfigCompiler {
  readonly runtimeId = "pi";
  private readonly apiKinds = ["anthropic-messages", "openai-responses", "openai-completions", "google-generative-ai", "google-vertex", "bedrock-converse-stream"];
  describeCapabilities() { return base(this.apiKinds, "unsupported"); }
  validate(input: RuntimeConfigurationInput) { return supported(input, this.apiKinds); }
  async compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null) {
    this.requireValid(input);
    const credential = this.credential(activation);
    const root = await this.privateRoot(input, "pi-agent");
    const file = await this.privateFile(root, "models.json", JSON.stringify({
      providers: { kith: { baseUrl: input.canonicalOrigin,
        ...(credential ? { apiKey: "$KITH_PI_API_KEY" } : {}), api: input.apiKind,
        models: [{ id: input.modelId, name: input.modelId }] } },
    }));
    return this.result(input, activation, {
      args: ["--mode", "rpc", "--provider", "kith", "--model", input.modelId, "--no-approve", "--no-context-files",
        "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
      env: { PI_CODING_AGENT_DIR: root, ...(credential ? { KITH_PI_API_KEY: credential } : {}),
        PI_DISABLE_UPDATE_CHECK: "1", DO_NOT_TRACK: "1" },
      files: [file], cleanupRoot: root,
    });
  }
}

/**
 * Built-in Pi Agent runtime: the bundled pi-agent-helper speaks the same
 * `--mode rpc` protocol as the external Pi CLI, so the compiled surface is
 * identical except that unmanaged CLI-native mode does not exist (the runtime
 * ships with the app) and a minimal settings.json pins project trust to never.
 */
export class PiBuiltinRuntimeConfigCompiler extends BaseRuntimeConfigCompiler {
  readonly runtimeId = "pi-builtin";
  private readonly apiKinds = ["anthropic-messages", "openai-responses", "openai-completions", "google-generative-ai", "google-vertex", "bedrock-converse-stream"];
  describeCapabilities() {
    const capabilities = base(this.apiKinds, "unsupported");
    return { ...capabilities, unmanagedCliNative: false };
  }
  validate(input: RuntimeConfigurationInput) { return supported(input, this.apiKinds); }
  async compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null) {
    this.requireValid(input);
    const credential = this.credential(activation);
    const root = await this.privateRoot(input, "pi-builtin");
    const files = [
      await this.privateFile(root, "models.json", JSON.stringify({
        providers: { kith: { baseUrl: input.canonicalOrigin,
          ...(credential ? { apiKey: "$KITH_PI_API_KEY" } : {}), api: input.apiKind,
          models: [{ id: input.modelId, name: input.modelId }] } },
      })),
      await this.privateFile(root, "settings.json", JSON.stringify({ defaultProjectTrust: "never" })),
    ];
    return this.result(input, activation, {
      args: ["--mode", "rpc", "--provider", "kith", "--model", input.modelId,
        ...(input.reasoning ? ["--thinking", input.reasoning] : []),
        "--no-approve", "--no-context-files", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-themes"],
      env: { PI_CODING_AGENT_DIR: root, ...(credential ? { KITH_PI_API_KEY: credential } : {}),
        PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_DISABLE_UPDATE_CHECK: "1", DO_NOT_TRACK: "1" },
      files, cleanupRoot: root,
    });
  }
}
