import { AgentOnboardingService } from "../../personal-setup/agentOnboardingService.js";
import { sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

const onboarding = new AgentOnboardingService();

/** One-time Agent creation wizard gate, installation-level (human scope). */
export function handleAgentOnboarding(ctx: HumanCtx): boolean {
  if (ctx.p === "/api/setup/agent-onboarding" && ctx.method === "GET") {
    return (sendJson(ctx.res, 200, onboarding.status()), true);
  }
  if (ctx.p === "/api/setup/agent-onboarding/complete" && ctx.method === "POST") {
    return (sendJson(ctx.res, 200, onboarding.complete()), true);
  }
  return false;
}
