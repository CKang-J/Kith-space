import { revokeAgentChannelAccess } from "../channels/channelAgentAccessRevocation.js";
import { harnessTurnScheduler, turnCapabilityService } from "./harnessComposition.js";
import { cancelActiveAdvisorRuns } from "../advisor-provider/activeAdvisorRuns.js";

/** Channel Module composition: DB revocation is authoritative; in-memory/Worker handles are post-commit cleanup. */
export async function revokeChannelAgentAccess(spaceId: string, channelId: string, agentId: string) {
  await cancelActiveAdvisorRuns({ spaceId, agentId, channelId });
  const result = revokeAgentChannelAccess(spaceId, channelId, agentId);
  if (!result.changed) return result;
  turnCapabilityService(spaceId).closeSessions(result.sessionIds);
  harnessTurnScheduler.cancelRevokedAttempts(result.attempts);
  return result;
}
