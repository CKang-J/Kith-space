import type {
  GenerationJobType,
  GenerationProvider,
  IGenerationProvider,
} from "./contracts.js";
import { DoubaoImageProvider } from "./providers/doubaoImageProvider.js";
import { SeedreamVideoProvider } from "./providers/seedreamVideoProvider.js";
import { listStoredProviderConfigs } from "./providerConfig.js";
import { createLogger } from "../../log.js";

export type {
  GenerationRequest,
  GenerationStatus,
  IGenerationProvider,
} from "./contracts.js";

const log = createLogger("canvas-generation");
const providers = new Map<GenerationProvider, IGenerationProvider>();

export function registerGenerationProvider(provider: IGenerationProvider): void {
  providers.set(provider.name, provider);
}

export function getGenerationProvider(name: GenerationProvider): IGenerationProvider | undefined {
  return providers.get(name);
}

export function listGenerationProviders(): IGenerationProvider[] {
  return [...providers.values()];
}

export function listGenerationProvidersOfType(type: GenerationJobType): IGenerationProvider[] {
  return listGenerationProviders().filter((provider) => provider.type === type);
}

export function preferredGenerationProvider(type: GenerationJobType): IGenerationProvider | undefined {
  const registered = listGenerationProvidersOfType(type);
  if (type === "image") {
    return registered.find((provider) => provider.name === "doubao") ?? registered[0];
  }
  return registered.find((provider) => provider.name === "seedream") ?? registered[0];
}

export function clearGenerationProviders(): void {
  providers.clear();
}

export async function initializeGenerationProvidersFromStore(): Promise<void> {
  clearGenerationProviders();
  const configs = await listStoredProviderConfigs();
  for (const config of configs) {
    if (!config.enabled || !config.apiKey) continue;
    if (config.name === "doubao") {
      registerGenerationProvider(new DoubaoImageProvider(config.apiKey, config.endpoint, config.model));
      continue;
    }
    if (config.name === "seedream") {
      registerGenerationProvider(new SeedreamVideoProvider(config.apiKey, config.endpoint, config.model));
    }
  }
  log.info("generation providers initialized", {
    image: listGenerationProvidersOfType("image").map((provider) => provider.name),
    video: listGenerationProvidersOfType("video").map((provider) => provider.name),
  });
}
