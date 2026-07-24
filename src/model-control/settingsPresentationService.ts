import type {
  ModelConfiguration,
  ModelConfigurationRevision,
  ModelProviderConnection,
  ModelProviderConnectionRevision,
} from "./contracts.js";

function destinationLabel(networkClass: ModelProviderConnectionRevision["networkClass"]): string {
  if (networkClass === "loopback") return "Local";
  if (networkClass === "lan") return "Private network";
  return "Cloud";
}

export class SettingsPresentationService {
  presentModelConfiguration(input: {
    connection: ModelProviderConnection;
    provider: ModelProviderConnectionRevision;
    configuration: ModelConfiguration;
    model: ModelConfigurationRevision;
  }) {
    const origin = new URL(input.provider.canonicalOrigin);
    return {
      id: input.configuration.id,
      displayName: input.configuration.displayName,
      status: input.configuration.status,
      currentRevision: input.configuration.currentRevision,
      provider: {
        id: input.connection.id,
        displayName: input.connection.displayName,
        backendId: input.provider.backendId,
        apiKind: input.provider.apiKind,
        credential: input.provider.credentialRef ? "configured" : "not_required",
      },
      modelId: input.model.modelId,
      reasoning: input.model.reasoning,
      contextWindow: input.model.contextWindow,
      maxOutputTokens: input.model.maxOutputTokens,
      inputCapabilities: [...input.model.inputCapabilities],
      compatibility: { ...input.model.runtimeCompatibilitySnapshot },
      destination: {
        host: origin.host,
        networkClass: input.provider.networkClass,
        label: destinationLabel(input.provider.networkClass),
      },
    };
  }
}
