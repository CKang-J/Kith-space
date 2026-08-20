import { z } from "zod";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { browserRequestIsLocal } from "../browserSessionHttp.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";
import {
  arkSettingsViewFromProviders,
  listProviderSettingsViews,
  openrouterSettingsViewFromProviders,
  saveArkSharedConfig,
  saveProviderConfig,
} from "../../canvas/generation/providerConfig.js";
import { initializeGenerationProvidersFromStore } from "../../canvas/generation/generationProviders.js";
import type { GenerationProvider } from "../../canvas/generation/contracts.js";

const SETTINGS_PATH = "/api/settings/generation-providers";
const ProviderName = z.enum(["ark", "doubao", "seedream", "openrouter", "stability", "runway", "dalle", "pika"]);
const PatchSchema = z.object({
  name: ProviderName,
  apiKey: z.string().max(8_000).optional(),
  endpoint: z.string().max(500).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();

async function settingsPayload() {
  const providers = await listProviderSettingsViews();
  return {
    ark: arkSettingsViewFromProviders(providers),
    openrouter: openrouterSettingsViewFromProviders(providers),
    providers,
  };
}

export async function handleGenerationProviderSettings(ctx: HumanCtx): Promise<boolean> {
  const { req, res, method, p } = ctx;
  if (p !== SETTINGS_PATH) return false;

  if (method === "GET") {
    return (sendJson(res, 200, await settingsPayload()), true);
  }
  if (method === "PATCH") {
    try {
      const body = PatchSchema.parse(await readJson(req));
      const canWriteSecret = isDesktopTrustedRequest(req) || browserRequestIsLocal(req);
      if (body.apiKey && !canWriteSecret) {
        return (sendErr(res, 403, "generation API keys can only be written from Desktop or this machine", {
          code: "desktop_trust_required",
        }), true);
      }
      if (body.name === "ark") {
        await saveArkSharedConfig({
          apiKey: body.apiKey,
          endpoint: body.endpoint,
          enabled: body.enabled,
        });
      } else {
        await saveProviderConfig({
          name: body.name as GenerationProvider,
          apiKey: body.apiKey,
          endpoint: body.endpoint,
          model: body.model,
          enabled: body.enabled,
        });
      }
      await initializeGenerationProvidersFromStore();
      return (sendJson(res, 200, await settingsPayload()), true);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return (sendErr(res, 400, "invalid generation provider settings", { issues: error.issues }), true);
      }
      throw error;
    }
  }
  return (sendErr(res, 404, "not found"), true);
}
