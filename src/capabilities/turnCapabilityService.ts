import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import { SessionCapabilityBroker } from "./sessionCapabilityBroker.js";
import type { TurnCapabilityClaims } from "./contracts.js";

export interface PreparedTurnCapability {
  sessionHandle: string;
  claims: TurnCapabilityClaims;
}

export class TurnCapabilityService {
  private readonly handles = new Map<string, string>();

  constructor(
    private readonly spaceId: string,
    private readonly broker: SessionCapabilityBroker,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  prepare(attemptId: string): PreparedTurnCapability {
    const attempt = this.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
    const turn = attempt ? this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get() : null;
    const session = turn ? this.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, turn.runtimeSessionId)).get() : null;
    if (!attempt || !turn || !session || attempt.status !== "claimed" || session.retiredAt) {
      throw new HarnessError("attempt_lease_conflict", "cannot prepare capability for an unclaimed attempt", { attemptId });
    }
    const deliveries = this.db.select().from(schema.agentDeliveryItems).where(and(
      eq(schema.agentDeliveryItems.turnId, turn.id),
      eq(schema.agentDeliveryItems.disposition, "bound"),
    )).all();
    const activationId = randomUUID();
    const claims: TurnCapabilityClaims = {
      schemaVersion: 1,
      activationId,
      turnId: turn.id,
      attemptId: attempt.id,
      sessionId: session.id,
      sessionGeneration: session.sessionGeneration,
      workerGeneration: attempt.workerGeneration,
      spaceId: turn.spaceId,
      agentId: turn.agentId,
      allowedOutputSurfaceIds: [session.surfaceId],
      allowedInputIds: deliveries.map((delivery) => delivery.id),
      seenWatermarks: [...new Map(deliveries.map((delivery) => [
        delivery.sourceChannelId,
        { channelId: delivery.sourceChannelId, throughSeq: delivery.sourceSeq },
      ])).values()],
      scopes: ["context.check", "turn.reply", "turn.cede"],
      disclosureGrantIds: [],
      expiresAt: attempt.leaseExpiresAt.getTime(),
    };
    const digest = createHash("sha256").update(JSON.stringify(claims)).digest("hex");
    this.db.insert(schema.turnCapabilityActivations).values({
      id: activationId,
      turnId: turn.id,
      attemptId: attempt.id,
      sessionGeneration: session.sessionGeneration,
      workerGeneration: attempt.workerGeneration,
      claimsDigest: digest,
      status: "pending",
      expiresAt: attempt.leaseExpiresAt,
    }).run();
    let sessionHandle = this.handles.get(session.id);
    if (!sessionHandle) {
      sessionHandle = this.broker.openSession({
        sessionId: session.id,
        sessionGeneration: session.sessionGeneration,
        spaceId: turn.spaceId,
        agentId: turn.agentId,
      });
      this.handles.set(session.id, sessionHandle);
    }
    return { sessionHandle, claims };
  }

  activate(prepared: PreparedTurnCapability): void {
    this.broker.activate(prepared.sessionHandle, prepared.claims);
    const now = new Date(this.now());
    const updated = this.db.update(schema.turnCapabilityActivations).set({ status: "active", activatedAt: now }).where(and(
      eq(schema.turnCapabilityActivations.id, prepared.claims.activationId),
      eq(schema.turnCapabilityActivations.status, "pending"),
    )).run();
    if (!updated.changes) {
      this.broker.deactivate(prepared.sessionHandle, prepared.claims.activationId);
      throw new HarnessError("capability_inactive", "capability activation is no longer pending", { activationId: prepared.claims.activationId });
    }
  }

  resolve(input: {
    sessionHandle: string;
    activationId: string;
    workerGeneration: number;
    scope: "context.check" | "turn.reply" | "turn.cede";
  }): TurnCapabilityClaims {
    const claims = this.broker.resolve({
      sessionHandle: input.sessionHandle,
      activationId: input.activationId,
      workerGeneration: input.workerGeneration,
    });
    if (!claims.scopes.includes(input.scope)) throw new HarnessError("capability_scope_denied", `activation does not allow ${input.scope}`);
    const activation = this.db.select().from(schema.turnCapabilityActivations)
      .where(eq(schema.turnCapabilityActivations.id, claims.activationId)).get();
    const attempt = this.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, claims.attemptId)).get();
    if (!activation || activation.status !== "active" || !attempt || !["admitted", "running", "finalizing"].includes(attempt.status)) {
      throw new HarnessError("capability_inactive", "attempt activation is not active", { activationId: claims.activationId });
    }
    if (activation.expiresAt.getTime() <= this.now() || attempt.leaseExpiresAt.getTime() <= this.now()) {
      throw new HarnessError("capability_expired", "attempt activation expired", { activationId: claims.activationId });
    }
    return claims;
  }

  renewAttempt(attemptId: string, expiresAt: number): TurnCapabilityClaims {
    const activation = this.db.select().from(schema.turnCapabilityActivations).where(and(
      eq(schema.turnCapabilityActivations.attemptId, attemptId),
      eq(schema.turnCapabilityActivations.status, "active"),
    )).get();
    const attempt = this.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
    const turn = attempt ? this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get() : null;
    if (!activation || !attempt || !turn || !["admitted", "running", "finalizing"].includes(attempt.status)) {
      throw new HarnessError("capability_inactive", "cannot renew an inactive attempt capability", { attemptId });
    }
    if (attempt.leaseExpiresAt.getTime() !== expiresAt || expiresAt <= this.now()) {
      throw new HarnessError("attempt_lease_expired", "capability renewal does not match the live attempt lease", { attemptId, expiresAt });
    }
    const handle = this.handles.get(turn.runtimeSessionId);
    if (!handle) throw new HarnessError("capability_inactive", "runtime session broker handle is unavailable", { attemptId });
    const claims = this.broker.renew(handle, activation.id, expiresAt);
    const claimsDigest = createHash("sha256").update(JSON.stringify(claims)).digest("hex");
    const updated = this.db.update(schema.turnCapabilityActivations).set({
      expiresAt: new Date(expiresAt),
      claimsDigest,
    }).where(and(
      eq(schema.turnCapabilityActivations.id, activation.id),
      eq(schema.turnCapabilityActivations.status, "active"),
    )).run();
    if (!updated.changes) {
      this.broker.deactivate(handle, activation.id);
      throw new HarnessError("capability_inactive", "capability activation changed during renewal", { attemptId });
    }
    return claims;
  }

  deactivate(sessionHandle: string, activationId: string): void {
    this.broker.deactivate(sessionHandle, activationId);
    this.db.update(schema.turnCapabilityActivations).set({ status: "revoked", revokedAt: new Date(this.now()) })
      .where(eq(schema.turnCapabilityActivations.id, activationId)).run();
  }

  revokeAttempt(attemptId: string): void {
    const activation = this.db.select().from(schema.turnCapabilityActivations)
      .where(eq(schema.turnCapabilityActivations.attemptId, attemptId)).get();
    if (!activation || activation.status === "revoked" || activation.status === "expired") return;
    const attempt = this.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get();
    const turn = attempt ? this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, attempt.turnId)).get() : null;
    if (turn) {
      const handle = this.handles.get(turn.runtimeSessionId);
      if (handle) this.broker.deactivate(handle, activation.id);
    }
    this.db.update(schema.turnCapabilityActivations).set({ status: "revoked", revokedAt: new Date(this.now()) })
      .where(eq(schema.turnCapabilityActivations.id, activation.id)).run();
  }

  expireStaleActivations(): number {
    const now = new Date(this.now());
    const expired = this.db.select({ id: schema.turnCapabilityActivations.id }).from(schema.turnCapabilityActivations).where(and(
      inArray(schema.turnCapabilityActivations.status, ["pending", "active"]),
      lte(schema.turnCapabilityActivations.expiresAt, now),
    )).all();
    if (!expired.length) return 0;
    for (const activation of expired) {
      const row = this.db.select({ runtimeSessionId: schema.agentTurns.runtimeSessionId }).from(schema.turnCapabilityActivations)
        .innerJoin(schema.agentTurns, eq(schema.agentTurns.id, schema.turnCapabilityActivations.turnId))
        .where(eq(schema.turnCapabilityActivations.id, activation.id)).get();
      const handle = row ? this.handles.get(row.runtimeSessionId) : null;
      if (handle) this.broker.deactivate(handle, activation.id);
    }
    return this.db.update(schema.turnCapabilityActivations).set({ status: "expired", revokedAt: now })
      .where(inArray(schema.turnCapabilityActivations.id, expired.map((activation) => activation.id))).run().changes;
  }

  closeSession(sessionId: string): void {
    const handle = this.handles.get(sessionId);
    if (!handle) return;
    this.handles.delete(sessionId);
    this.broker.closeSession(handle);
  }
}
