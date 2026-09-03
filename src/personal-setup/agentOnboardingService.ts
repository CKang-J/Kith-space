import { appDataConnection, getHomeSpaceId } from "../app-data/appDatabase.js";
import { dbForSpace } from "../db/index.js";
import * as schema from "../db/schema.js";

export interface AgentOnboardingStatus {
  pending: boolean;
  completedAt: number | null;
  homeSpaceId: string | null;
  homeAgentCount: number;
}

/**
 * One-time "create your first Agent" onboarding gate. The wizard shows while
 * `agent_onboarding_completed_at` is NULL (per installation, app.db v13) and
 * completes on explicit finish or skip; a manually created Agent does not
 * silently dismiss it.
 */
export class AgentOnboardingService {
  status(): AgentOnboardingStatus {
    const sqlite = appDataConnection();
    const completedAt = sqlite.prepare(`
      SELECT agent_onboarding_completed_at FROM installation_state WHERE singleton_key = 1
    `).pluck().get() as number | null;
    const homeSpaceId = getHomeSpaceId() ?? null;
    let homeAgentCount = 0;
    if (homeSpaceId) {
      try {
        homeAgentCount = dbForSpace(homeSpaceId).select().from(schema.agents).all().length;
      } catch {
        homeAgentCount = 0;
      }
    }
    return { pending: completedAt === null, completedAt, homeSpaceId, homeAgentCount };
  }

  complete(): AgentOnboardingStatus {
    const sqlite = appDataConnection();
    const now = Date.now();
    sqlite.prepare(`
      UPDATE installation_state SET agent_onboarding_completed_at = ?
      WHERE singleton_key = 1 AND agent_onboarding_completed_at IS NULL
    `).run(now);
    return this.status();
  }
}
