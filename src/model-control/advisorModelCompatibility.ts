import { advisorAuthenticationCapability } from "../advisor-provider/advisorAuthentication.js";
import { piSdkModelRunnability } from "../advisor-provider/advisorModelRunnability.js";
import type { AdvisorApiKind, AdvisorCredentialSourceKind, AdvisorNetworkClass } from "../advisor-provider/contracts.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import type { RuntimeCompatibility } from "./contracts.js";

export type AdvisorExecutorId = "pi_sdk" | "claude_cli";

export function advisorModelCompatibility(input: {
  executorId: AdvisorExecutorId;
  backendId: string;
  modelId: string;
  apiKind: AdvisorApiKind;
  canonicalOrigin: string;
  credentialSourceKind: AdvisorCredentialSourceKind;
  networkClass: AdvisorNetworkClass;
  thinkingLevel?: string | null;
  runtimeCompatibilitySnapshot?: Partial<Record<RuntimeId | "pi_sdk", RuntimeCompatibility>>;
}): RuntimeCompatibility {
  // A dedicated advisor snapshot entry is authoritative when present. The chat
  // runtime's `pi` entry is intentionally ignored: it is wire-level only and
  // would accept configurations the advisor helper cannot serve.
  const runtimeCompatibility = input.executorId === "pi_sdk"
    ? input.runtimeCompatibilitySnapshot?.pi_sdk
    : input.runtimeCompatibilitySnapshot?.claude;
  if (runtimeCompatibility) return runtimeCompatibility;
  const auth = advisorAuthenticationCapability(input.executorId, {
    backendId: input.backendId,
    apiKind: input.apiKind,
    canonicalOrigin: input.canonicalOrigin,
    credentialSourceKind: input.credentialSourceKind,
  });
  if (!auth.supported) return { supported: false, reason: auth.reason };
  if (input.executorId === "claude_cli") return { supported: true };
  const runnability = piSdkModelRunnability({
    backendId: input.backendId,
    modelId: input.modelId,
    apiKind: input.apiKind,
    canonicalOrigin: input.canonicalOrigin,
    thinkingLevel: input.thinkingLevel,
  });
  return runnability.supported
    ? { supported: true }
    : { supported: false, reason: runnability.reason };
}
