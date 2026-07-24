import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdvisorNetworkClass } from "../../advisor-provider/contracts.js";
import type { RuntimeId } from "../../local-runtime/runtimeCatalog.js";

export interface RuntimeConfigurationCapabilities {
  managedConfiguration: boolean;
  unmanagedCliNative: boolean;
  supportedApiKinds: readonly string[];
  mcpBootstrap: "supported" | "unsupported";
}

export interface RuntimeConfigurationInput {
  runtimeId: RuntimeId;
  runtimeVersion: string | null;
  runtimeStateDir: string;
  modelId: string;
  reasoning: string | null;
  apiKind: string;
  canonicalOrigin: string;
  networkClass: AdvisorNetworkClass;
  backendId: string;
  providerOptions: Readonly<Record<string, unknown>>;
  compilerPolicyVersion: number;
  compilerPolicyDigest: string;
}

export interface ActivatedRuntimeCredential {
  value: string | null;
  identityDigest: string;
}

export interface EphemeralConfigFile {
  path: string;
  purpose: string;
}

export interface EffectiveRuntimeConfiguration {
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  ephemeralFiles: readonly EphemeralConfigFile[];
  effectiveModelId: string;
  effectiveReasoning: string | null;
  destination: { origin: string; networkClass: AdvisorNetworkClass };
  fingerprint: string;
  cleanup(): Promise<void>;
}

export interface RuntimeConfigurationValidation {
  valid: boolean;
  reason?: string;
}

export interface RuntimeConfigCompiler {
  readonly runtimeId: RuntimeId;
  describeCapabilities(runtimeVersion: string | null): RuntimeConfigurationCapabilities;
  validate(input: RuntimeConfigurationInput): RuntimeConfigurationValidation;
  compile(input: RuntimeConfigurationInput, activation: ActivatedRuntimeCredential | null): Promise<EffectiveRuntimeConfiguration>;
}

export function configurationFingerprint(input: RuntimeConfigurationInput, credentialIdentityDigest: string | null): string {
  return createHash("sha256").update(JSON.stringify({
    runtimeId: input.runtimeId, modelId: input.modelId, reasoning: input.reasoning, apiKind: input.apiKind,
    canonicalOrigin: input.canonicalOrigin, networkClass: input.networkClass, backendId: input.backendId,
    providerOptions: input.providerOptions, compilerPolicyVersion: input.compilerPolicyVersion,
    compilerPolicyDigest: input.compilerPolicyDigest, credentialIdentityDigest,
  })).digest("hex");
}

export abstract class BaseRuntimeConfigCompiler implements RuntimeConfigCompiler {
  abstract readonly runtimeId: RuntimeId;
  abstract describeCapabilities(runtimeVersion: string | null): RuntimeConfigurationCapabilities;
  abstract validate(input: RuntimeConfigurationInput): RuntimeConfigurationValidation;
  abstract compile(
    input: RuntimeConfigurationInput,
    activation: ActivatedRuntimeCredential | null,
  ): Promise<EffectiveRuntimeConfiguration>;
  protected result(
    input: RuntimeConfigurationInput,
    activation: ActivatedRuntimeCredential | null,
    values: { args: string[]; env: Record<string, string>; files?: EphemeralConfigFile[]; cleanupRoot?: string },
  ): EffectiveRuntimeConfiguration {
    return {
      args: values.args, env: values.env, ephemeralFiles: values.files ?? [], effectiveModelId: input.modelId,
      effectiveReasoning: input.reasoning, destination: { origin: input.canonicalOrigin, networkClass: input.networkClass },
      fingerprint: configurationFingerprint(input, activation?.identityDigest ?? null),
      cleanup: async () => { if (values.cleanupRoot) await rm(values.cleanupRoot, { recursive: true, force: true }); },
    };
  }

  protected requireValid(input: RuntimeConfigurationInput): void {
    const validation = this.validate(input);
    if (!validation.valid) throw new Error(validation.reason ?? "runtime configuration incompatible");
  }

  protected credential(activation: ActivatedRuntimeCredential | null): string | null {
    if (!activation || !activation.identityDigest) throw new Error("runtime credential activation required");
    return activation.value;
  }

  protected async privateRoot(input: RuntimeConfigurationInput, prefix: string): Promise<string> {
    const root = path.join(input.runtimeStateDir, `${prefix}-${randomUUID()}`);
    await mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  protected async privateFile(root: string, name: string, content: string): Promise<EphemeralConfigFile> {
    const target = path.join(root, name);
    await writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { path: target, purpose: "runtime_configuration" };
  }
}
