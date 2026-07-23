import { appDataConnection } from "../app-data/appDatabase.js";
import { ModelControlError } from "./contracts.js";
import {
  ModelConfigurationService,
  type SaveModelConfigurationInput,
} from "./modelConfigurationService.js";
import {
  ModelProviderConnectionService,
  type SaveModelProviderConnectionInput,
} from "./modelProviderConnectionService.js";
import { withRuntimeConfigurationChange } from "./runtimeConfigurationChange.js";
import { markAgentsForRuntimeConfigurationChange } from "./runtimeConfigurationImpact.js";

export interface SaveProviderBundleInput {
  providerId?: string;
  provider: SaveModelProviderConnectionInput;
  models: ReadonlyArray<{
    id?: string;
    displayName: string;
    modelId: string;
  }>;
}

/**
 * One user-facing provider edit is one app.db transaction. This prevents the
 * provider revision, retained models, and removals from becoming partially visible.
 */
export class ModelProviderBundleService {
  constructor(
    private readonly providers = new ModelProviderConnectionService(),
    private readonly configurations = new ModelConfigurationService(providers),
  ) {}

  async save(input: SaveProviderBundleInput) {
    const modelIds = input.models.flatMap((model) => model.id ? [model.id] : []);
    if (new Set(modelIds).size !== modelIds.length) {
      throw new ModelControlError("model_configuration_not_found", "duplicate model configuration");
    }
    if (input.models.some((model) => !model.displayName.trim() || !model.modelId.trim())) {
      throw new ModelControlError("model_configuration_not_found", "model fields are required");
    }

    return withRuntimeConfigurationChange(() => {
      const sqlite = appDataConnection();
      const result = sqlite.transaction(() => {
        const previous = input.providerId
          ? this.configurations.list().filter(({ configuration, revision }) =>
              configuration.status === "active" && revision.providerConnectionId === input.providerId)
          : [];
        const previousById = new Map(previous.map((item) => [item.configuration.id, item]));
        if (modelIds.some((id) => !previousById.has(id))) {
          throw new ModelControlError("model_configuration_not_found");
        }
        const kept = new Set(modelIds);
        const removedIds = previous
          .map(({ configuration }) => configuration.id)
          .filter((id) => !kept.has(id));
        this.configurations.assertCanDisable(removedIds);

        const provider = input.providerId
          ? this.providers.updateWithinConfigurationChange(input.providerId, input.provider)
          : this.providers.createWithinConfigurationChange(input.provider);
        if (removedIds.length > 0) {
          this.configurations.disableWithinConfigurationChange(removedIds);
        }
        const models = input.models.map((draft) => {
          const modelInput: SaveModelConfigurationInput = {
            displayName: draft.displayName.trim(),
            providerConnectionId: provider.connection.id,
            providerRevision: provider.connection.currentRevision,
            modelId: draft.modelId.trim(),
            ...(draft.id ? {
              reasoning: previousById.get(draft.id)!.revision.reasoning,
              contextWindow: previousById.get(draft.id)!.revision.contextWindow,
              maxOutputTokens: previousById.get(draft.id)!.revision.maxOutputTokens,
              inputCapabilities: previousById.get(draft.id)!.revision.inputCapabilities,
              options: previousById.get(draft.id)!.revision.options,
            } : {}),
          };
          return draft.id
            ? this.configurations.updateWithinConfigurationChange(draft.id, modelInput)
            : this.configurations.createWithinConfigurationChange(modelInput);
        });
        return {
          provider,
          models,
          changedIds: [...new Set([...modelIds, ...removedIds])],
        };
      }).immediate();
      if (result.changedIds.length > 0) {
        markAgentsForRuntimeConfigurationChange({ configurationIds: result.changedIds });
      }
      return { provider: result.provider, models: result.models };
    });
  }
}
