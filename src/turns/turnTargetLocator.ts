import { and, eq } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";

export interface LocatedTurnTarget {
  spaceId: string;
  db: SpaceDb;
}

/** Resolve a Worker turn only inside its signed/admitted Space; never scan unrelated registry entries. */
export function locateTurnTarget(input: {
  spaceId: string;
  turnId: string;
  attemptId: string;
  sessionId: string;
}): LocatedTurnTarget | null {
  const db = dbForSpace(input.spaceId);
  const turn = db.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
    eq(schema.agentTurns.id, input.turnId),
    eq(schema.agentTurns.spaceId, input.spaceId),
    eq(schema.agentTurns.runtimeSessionId, input.sessionId),
  )).get();
  if (!turn) return null;
  const attempt = db.select({ id: schema.agentTurnAttempts.id }).from(schema.agentTurnAttempts).where(and(
    eq(schema.agentTurnAttempts.id, input.attemptId),
    eq(schema.agentTurnAttempts.turnId, input.turnId),
  )).get();
  return attempt ? { spaceId: input.spaceId, db } : null;
}
