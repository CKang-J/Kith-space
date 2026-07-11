import crypto from "node:crypto";
import { findAgentById } from "../db/lookup.js";

/** Constant-time string compare for secrets (token/key). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export const newKey = (prefix: string) => prefix + crypto.randomBytes(24).toString("hex");
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Resolve an agent's own per-agent credential. Internal Desktop and Worker credentials
 * are deliberately not accepted on the agent data plane.
 */
export async function resolveAgent(token: string | null, agentId: string | null) {
  if (!token || !agentId) return null;
  const agent = (await findAgentById(agentId))?.value;
  if (agent?.deletedAt) return null;
  if (!agent || !agent.agentTokenHash) return null;
  if (safeEqual(hashToken(token), agent.agentTokenHash)) return agent;
  return null;
}
