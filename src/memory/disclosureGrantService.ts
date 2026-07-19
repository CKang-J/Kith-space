import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DisclosureSourceRefSchema, type DisclosureSourceRef } from "../capabilities/contracts.js";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { memoryHmac } from "./memoryIntegrity.js";

export const IssueDisclosureGrantCommandSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  sourceRefs: z.array(DisclosureSourceRefSchema).min(1).max(20),
  allowedProjection: z.enum(["canonical", "internal_summary", "shareable_summary"]),
  ttlSeconds: z.number().int().min(30).max(600).default(120),
}).strict();

export function disclosureActionDigest(body: string, sourceRefs: DisclosureSourceRef[]): string {
  return memoryHmac({ body: body.trim(), sourceRefs });
}

/** Human-issued, turn-bound, consume-once disclosure authority. */
export class DisclosureGrantService {
  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  issue(turnId: string, raw: z.input<typeof IssueDisclosureGrantCommandSchema>, humanId: string) {
    const command = IssueDisclosureGrantCommandSchema.parse(raw);
    return this.db.transaction((tx) => {
      const turn = tx.select().from(schema.agentTurns).where(and(
        eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.spaceId, this.spaceId),
      )).get();
      if (!turn || turn.status !== "running") throw new HarnessError("capability_inactive", "disclosure grant requires a running turn");
      const session = tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get();
      if (!session || session.retiredAt || session.sessionGeneration !== turn.sessionGeneration) {
        throw new HarnessError("session_generation_stale", "disclosure grant target session is stale");
      }
      for (const ref of command.sourceRefs) {
        const source = tx.select().from(schema.turnContextSources).where(and(
          eq(schema.turnContextSources.turnId, turnId),
          eq(schema.turnContextSources.sourceKind, ref.sourceKind),
          eq(schema.turnContextSources.sourceId, ref.sourceId),
        )).all().find((item) => item.sourceRevision === ref.sourceRevision);
        if (!source) throw new HarnessError("disclosure_denied", "disclosure source is not in the turn audit", { sourceId: ref.sourceId });
      }
      const now = this.now();
      return tx.insert(schema.disclosureGrants).values({
        id: randomUUID(),
        turnId,
        sourceRefs: command.sourceRefs,
        targetSurfaceId: session.surfaceId,
        actionDigest: disclosureActionDigest(command.body, command.sourceRefs),
        allowedProjection: command.allowedProjection,
        status: "active",
        expiresAt: new Date(now + command.ttlSeconds * 1_000),
        createdBy: humanId,
      }).returning().get();
    });
  }

  revoke(grantId: string): void {
    this.db.update(schema.disclosureGrants).set({ status: "revoked" }).where(and(
      eq(schema.disclosureGrants.id, grantId),
      eq(schema.disclosureGrants.status, "active"),
    )).run();
  }
}
