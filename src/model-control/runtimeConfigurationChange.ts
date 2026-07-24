import { appDataConnection } from "../app-data/appDatabase.js";
import { providerCredentialPort } from "../advisor-provider/credentialPort.js";
import { runtimeConfigurationEpochGate } from "../runtime/config/runtimeConfigurationEpochGate.js";
import { runtimeCredentialActivationPort } from "../runtime/config/runtimeCredentialActivationPort.js";

function currentEpoch(): number {
  return Number(appDataConnection().prepare(`
    SELECT runtime_configuration_epoch FROM installation_state WHERE singleton_key = 1
  `).pluck().get());
}

/**
 * Serializes every model-control mutation against Worker credential admission.
 * The gate stays closed while the immutable revision and epoch advance together;
 * stale one-shot activations are revoked before the new epoch becomes admissible.
 */
export async function withRuntimeConfigurationChange<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  return runtimeConfigurationEpochGate.withChange(async () => {
    const before = currentEpoch();
    try {
      return await operation();
    } finally {
      const after = currentEpoch();
      if (after !== before) {
        providerCredentialPort.revokeRuntimeBeforeEpoch(after);
        runtimeCredentialActivationPort.revokeBeforeEpoch(after);
      }
      runtimeConfigurationEpochGate.open(after);
    }
  });
}
