// Human-facing REST: /api/* (Desktop trust or browser session + x-space-id)
//
// Thin dispatcher. It owns ONLY the three auth gates and the dispatch order; the actual route
// logic lives in the per-domain handlers in this directory. Each gate widens the context
// (public → +humanId → +spaceId, see ./ctx.ts) and then delegates to the handlers registered
// behind that gate. A handler returns `true` once it has matched a route and written the
// response, `false` to let the next handler try.
//
// Two things here are security-load-bearing and must not be reordered casually:
//   1. Gate order — which gate a handler sits behind IS its auth level (see docs/kith-space/architecture-proposal.md §6).
//   2. Gate-2 dispatch order — preserves the former monolith's EFFECTIVE first-match resolution
//      (not its physical line order: e.g. the `/api/channels/saved` routes now live in messages.ts
//      and are reached only after handleChannels declines them — safe because no channels.ts guard
//      matches those paths/methods). When adding a route, check it can't be shadowed by an
//      earlier-dispatched module's guard for the same path+method.
import type { IncomingMessage, ServerResponse } from "node:http";
import { spaceRecord, touchSpace } from "../../db/index.js";
import { sendErr, spaceIdHeader } from "../util.js";
import { browserMutationAllowed } from "../browserSessionHttp.js";
import { authenticateHumanRequest } from "../humanRequestAuth.js";
import type { BaseCtx, HumanCtx, SpaceCtx } from "./ctx.js";
import { handleHumanProfile } from "./humanProfile.js";
import { handleHostDirectories } from "./hostDirectories.js";
import { handleHumanAttachmentGet, handleAttachments } from "./attachments.js";
import { handleAuthenticatedBrowserAuth, handleDesktopBrowserAccess, handlePublicBrowserAuth } from "./browserAccess.js";
import { handleDesktopSettings } from "./desktopSettings.js";
import { handlePersonalSetup } from "./setup.js";
import { handleAgentOnboarding } from "./agentOnboarding.js";
import { handleSpacesHumanScope } from "./spaces.js";
import { handleLocalRuntimeHumanScope } from "./localRuntime.js";
import { handleSpacePreferences } from "./spacePreferences.js";
import { handleAgents } from "./agents.js";
import { handleReminders } from "./reminders.js";
import { handleChannels } from "./channels.js";
import { handleMessages } from "./messages.js";
import { handleTasks } from "./tasks.js";
import { handleDispatch } from "./dispatch.js";
import { handleTurns } from "./turns.js";
import { handleMemories } from "./memories.js";
import { handleMemoryAdvisor } from "./memoryAdvisor.js";
import { handleDisclosureGrants } from "./disclosureGrants.js";
import { handleAdvisorProvider } from "./advisorProvider.js";
import { handleModelSettings } from "./modelSettings.js";
import { handleAppearanceSettings } from "./appearanceSettings.js";
import { handleGenerationProviderSettings } from "./generationProviderSettings.js";
import { handleCanvas, handleCanvasAssetResolver } from "./canvas.js";
import { handleCanvasChat } from "./canvasChat.js";
import { handleCanvasGenerationJobs } from "./canvasGenerationJobs.js";

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> {
  const p = url.pathname;
  if (!p.startsWith("/api/")) return false;
  const base: BaseCtx = { req, res, url, method, p };

  // ---- gate 0: public / self-authenticating ----
  if (await handlePersonalSetup(base)) return true;
  if (await handleDesktopBrowserAccess(base)) return true;
  if (await handleDesktopSettings(base)) return true;
  if (await handlePublicBrowserAuth(base)) return true;

  // ---- gate 1: require Desktop trust or a persistent browser session ----
  const auth = authenticateHumanRequest(req);
  if (!auth) return (sendErr(res, 401, "browser authorization required"), true);
  if (auth.kind === "browser" && !browserMutationAllowed(req, auth.mode)) {
    return (sendErr(res, 403, "origin or CSRF check failed"), true);
  }
  const humanId = auth.humanId;
  const humanCtx: HumanCtx = { ...base, humanId };
  if (await handleAuthenticatedBrowserAuth(base, auth)) return true;
  if (await handleAgentOnboarding(humanCtx)) return true;
  if (await handleHumanAttachmentGet(humanCtx)) return true;
  if (await handleHumanProfile(humanCtx)) return true;
  if (await handleHostDirectories(humanCtx)) return true;
  if (await handleLocalRuntimeHumanScope(humanCtx)) return true;
  if (await handleSpacesHumanScope(humanCtx)) return true;
  if (await handleAppearanceSettings(humanCtx)) return true;
  if (await handleGenerationProviderSettings(humanCtx)) return true;
  if (await handleAdvisorProvider(humanCtx)) return true;
  if (await handleModelSettings(humanCtx)) return true;
  if (handleCanvasAssetResolver(humanCtx)) return true;

  // ---- gate 2: require a registered local Space context ----
  const spaceId = spaceIdHeader(req);
  if (!spaceId) return (sendErr(res, 400, "x-space-id header required"), true);
  const pathSpaceId = /^\/api\/spaces\/([^/]+)(?:\/|$)/.exec(p)?.[1];
  if (pathSpaceId && pathSpaceId !== spaceId) return (sendErr(res, 400, "path Space and x-space-id disagree"), true);
  if (!spaceRecord(spaceId)) return (sendErr(res, 404, "Space not found"), true);
  touchSpace(spaceId);
  const spaceCtx: SpaceCtx = { ...humanCtx, spaceId };

  if (await handleAgents(spaceCtx)) return true;
  if (await handleMemoryAdvisor(spaceCtx)) return true;
  if (await handleReminders(spaceCtx)) return true;
  if (await handleChannels(spaceCtx)) return true;
  if (await handleCanvasChat(spaceCtx)) return true;
  if (await handleMessages(spaceCtx)) return true;
  if (await handleTurns(spaceCtx)) return true;
  if (await handleDisclosureGrants(spaceCtx)) return true;
  if (await handleMemories(spaceCtx)) return true;
  if (await handleAttachments(spaceCtx)) return true;
  if (await handleSpacePreferences(spaceCtx)) return true;
  if (await handleDispatch(spaceCtx)) return true;
  if (await handleTasks(spaceCtx)) return true;
  if (await handleCanvas(spaceCtx)) return true;
  if (await handleCanvasGenerationJobs(spaceCtx)) return true;

  return (sendErr(res, 404, "not found"), true);
}
