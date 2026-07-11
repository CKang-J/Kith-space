import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { findAgentById } from "../db/lookup.js";

/** Require an env var or abort startup with a clear message. Never falls back to a weak default. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(
    `[Kith-space] Required env var ${name} is not set.\n` +
    `  Generate one:  openssl rand -hex 32\n` +
    `  Then add it to .env before starting the server.`
  );
  return v;
}

const SECRET = requireEnv("JWT_SECRET");
export const BOOTSTRAP_KEY = requireEnv("DAEMON_BOOTSTRAP_KEY");

export const signUser = (userId: string) => jwt.sign({ uid: userId }, SECRET, { expiresIn: "30d" });
export function verifyUser(token: string | null): string | null {
  if (!token) return null;
  try { return (jwt.verify(token, SECRET) as { uid?: string }).uid ?? null; } catch { return null; }
}

/** Temporary local-development JWT bootstrap for the canonical Human. Disabled by default.
 *  Defense in depth: NODE_ENV==='production' force-disables it even if ALLOW_DEV_LOGIN is set.
 *  Read at call-time (not module load) so the value is honored even if the env is mutated after import (e.g. tests). */
export const devLoginEnabled = (): boolean =>
  process.env.ALLOW_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

/** Constant-time string compare for secrets (token/key) — avoids leaking length-prefix matches via timing.
 *  Length mismatch short-circuits to false but only after a fixed-length compare to keep timing uniform. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) { crypto.timingSafeEqual(ab, ab); return false; }
  return crypto.timingSafeEqual(ab, bb);
}


export const newKey = (prefix: string) => prefix + crypto.randomBytes(24).toString("hex");
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** agent-api auth: Bearer = the agent's own per-agent token (`sk_agent_*`, injected by daemon at spawn, see slice10) + x-agent-id header.
 *  Identity is resolved by hashing the token and looking it up: the token must belong to the agent named in x-agent-id, which prevents cross-agent and cross-server impersonation.
 *  No shared bootstrap key; machine keys are not accepted as agent credentials (machine keys are used only for daemon WS connections, see ws.ts). */
export async function resolveAgent(token: string | null, agentId: string | null) {
  if (!token || !agentId) return null;
  // Reject soft-deleted agents: a deleted row keeps its id but must not authenticate (its token is cleared on
  // delete too — defense in depth). Without this, a deleted agent's still-running process keeps full access.
  const agent = (await findAgentById(agentId))?.value;
  if (agent?.deletedAt) return null;
  if (!agent || !agent.agentTokenHash) return null;
  if (safeEqual(hashToken(token), agent.agentTokenHash)) return agent;
  return null;
}
