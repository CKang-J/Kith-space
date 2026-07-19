import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import type { RuntimeSessionKey } from "../runtime/contract/v2/runtimeContract.js";

const DEFAULT_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface RuntimeSessionConfiguration {
  address: RuntimeSessionKey;
  runtime: string;
  model?: string | null;
  runtimeConfig?: Record<string, unknown> | null;
  adapterVersion: string;
  engineHostFingerprint?: string | null;
  workspaceRootFingerprint: string;
  allowWorkspaceRelocationResume?: boolean;
}

export type RuntimeSessionRecord = typeof schema.runtimeSessions.$inferSelect;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function runtimeConfigFingerprint(config: Record<string, unknown> | null | undefined): string {
  return createHash("sha256").update(canonicalJson(config ?? {})).digest("hex");
}

function auditHistory(value: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  const history = value?.history;
  return Array.isArray(history)
    ? history.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

/** Core-owned authority for mutually exclusive harness cutover and per-surface session generations. */
export class SessionModule {
  constructor(
    private readonly spaceId: string,
    private readonly db: SpaceDb = dbForSpace(spaceId),
    private readonly now: () => number = Date.now,
  ) {}

  harnessMode(agentId: string): "legacy" | "migrating" | "v2" {
    return this.db.select({ mode: schema.agentHarnessState.mode }).from(schema.agentHarnessState)
      .where(eq(schema.agentHarnessState.agentId, agentId)).get()?.mode ?? "legacy";
  }

  assertDataPlane(agentId: string, requested: "legacy" | "v2"): void {
    const actual = this.harnessMode(agentId);
    if (actual !== requested) {
      throw new HarnessError("harness_mode_conflict", `Agent ${agentId} is in ${actual} harness mode`, {
        agentId,
        actual,
        requested,
      });
    }
  }

  beginCutover(
    agentId: string,
    options: { legacyDrained: boolean; rollbackWindowMs?: number; reason: string },
  ): void {
    if (!options.legacyDrained) {
      throw new HarnessError("harness_mode_conflict", "legacy runtime must be drained before cutover", { agentId });
    }
    const now = this.now();
    this.db.transaction((tx) => {
      const current = tx.select().from(schema.agentHarnessState)
        .where(eq(schema.agentHarnessState.agentId, agentId)).get();
      const mode = current?.mode ?? "legacy";
      if (mode !== "legacy") {
        throw new HarnessError("harness_mode_conflict", `cannot begin cutover from ${mode}`, { agentId, actual: mode });
      }
      const history = auditHistory(current?.migrationAudit);
      history.push({ at: now, from: "legacy", to: "migrating", reason: options.reason, legacySessionPreserved: true });
      tx.insert(schema.agentHarnessState).values({
        agentId,
        mode: "migrating",
        rollbackUntil: new Date(now + (options.rollbackWindowMs ?? DEFAULT_ROLLBACK_WINDOW_MS)),
        migrationAudit: { history },
      }).onConflictDoUpdate({
        target: schema.agentHarnessState.agentId,
        set: {
          mode: "migrating",
          rollbackUntil: new Date(now + (options.rollbackWindowMs ?? DEFAULT_ROLLBACK_WINDOW_MS)),
          migrationAudit: { history },
        },
      }).run();
    });
  }

  completeCutover(agentId: string): void {
    const now = this.now();
    this.db.transaction((tx) => {
      const current = tx.select().from(schema.agentHarnessState)
        .where(eq(schema.agentHarnessState.agentId, agentId)).get();
      if (current?.mode !== "migrating") {
        throw new HarnessError("harness_mode_conflict", "Agent is not ready to complete v2 cutover", {
          agentId,
          actual: current?.mode ?? "legacy",
        });
      }
      const history = auditHistory(current.migrationAudit);
      history.push({ at: now, from: "migrating", to: "v2" });
      tx.update(schema.agentHarnessState).set({
        mode: "v2",
        cutoverAt: new Date(now),
        migrationAudit: { history },
      }).where(eq(schema.agentHarnessState.agentId, agentId)).run();
    });
  }

  rollbackToLegacy(agentId: string, options: { v2Drained: boolean; reason: string; acceptedAt?: number }): void {
    if (!options.v2Drained) {
      throw new HarnessError("harness_mode_conflict", "v2 sessions must be drained before rollback", { agentId });
    }
    const acceptedAt = options.acceptedAt ?? this.now();
    this.assertRollbackWindow(agentId, acceptedAt);
    const now = this.now();
    this.db.transaction((tx) => {
      const current = tx.select().from(schema.agentHarnessState)
        .where(eq(schema.agentHarnessState.agentId, agentId)).get();
      if (current?.mode !== "v2" || !current.rollbackUntil || current.rollbackUntil.getTime() <= acceptedAt) {
        throw new HarnessError("harness_mode_conflict", "Agent rollback authorization is no longer valid", { agentId });
      }
      const history = auditHistory(current.migrationAudit);
      history.push({ at: now, from: "v2", to: "legacy", reason: options.reason });
      tx.update(schema.runtimeSessions).set({
        status: "disabled",
        retiredAt: new Date(now),
        updatedAt: new Date(now),
      }).where(and(eq(schema.runtimeSessions.agentId, agentId), isNull(schema.runtimeSessions.retiredAt))).run();
      tx.update(schema.agentHarnessState).set({
        mode: "legacy",
        migrationAudit: { history },
      }).where(eq(schema.agentHarnessState.agentId, agentId)).run();
    });
  }

  assertRollbackWindow(agentId: string, acceptedAt = this.now()): number {
    const current = this.db.select().from(schema.agentHarnessState)
      .where(eq(schema.agentHarnessState.agentId, agentId)).get();
    if (current?.mode !== "v2") {
      throw new HarnessError("harness_mode_conflict", "Agent is not in v2 mode", { agentId, actual: current?.mode ?? "legacy" });
    }
    if (!current.rollbackUntil || current.rollbackUntil.getTime() <= acceptedAt) {
      throw new HarnessError("harness_mode_conflict", "Agent rollback window has expired", {
        agentId,
        rollbackUntil: current.rollbackUntil?.toISOString() ?? null,
      });
    }
    return acceptedAt;
  }

  ensureSession(configuration: RuntimeSessionConfiguration): RuntimeSessionRecord {
    const { address } = configuration;
    if (address.spaceId !== this.spaceId) {
      throw new HarnessError("capability_scope_denied", "Runtime session belongs to another Space", {
        expectedSpaceId: this.spaceId,
        actualSpaceId: address.spaceId,
      });
    }
    this.assertDataPlane(address.agentId, "v2");
    const fingerprint = runtimeConfigFingerprint(configuration.runtimeConfig);
    const now = new Date(this.now());
    return this.db.transaction((tx) => {
      const current = tx.select().from(schema.runtimeSessions).where(and(
        eq(schema.runtimeSessions.spaceId, address.spaceId),
        eq(schema.runtimeSessions.agentId, address.agentId),
        eq(schema.runtimeSessions.surfaceKind, address.surfaceKind),
        eq(schema.runtimeSessions.surfaceId, address.surfaceId),
        isNull(schema.runtimeSessions.retiredAt),
      )).get();
      const workspaceCompatible = current?.workspaceRootFingerprint === configuration.workspaceRootFingerprint
        || configuration.allowWorkspaceRelocationResume === true;
      const reusable = current
        && current.runtime === configuration.runtime
        && current.model === (configuration.model ?? null)
        && current.runtimeConfigFingerprint === fingerprint
        && current.adapterVersion === configuration.adapterVersion
        && current.engineHostFingerprint === (configuration.engineHostFingerprint ?? null)
        && workspaceCompatible;
      if (reusable) {
        if (current.workspaceRootFingerprint !== configuration.workspaceRootFingerprint) {
          tx.update(schema.runtimeSessions).set({
            workspaceRootFingerprint: configuration.workspaceRootFingerprint,
            updatedAt: now,
          }).where(eq(schema.runtimeSessions.id, current.id)).run();
          return { ...current, workspaceRootFingerprint: configuration.workspaceRootFingerprint, updatedAt: now };
        }
        return current;
      }
      if (current) {
        const activeTurn = tx.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(and(
          eq(schema.agentTurns.runtimeSessionId, current.id),
          inArray(schema.agentTurns.status, ["pending", "running", "retry_wait"]),
        )).get();
        if (activeTurn) {
          throw new HarnessError("attempt_lease_conflict", "runtime session configuration cannot change while a turn is non-terminal", {
            agentId: address.agentId,
            sessionId: current.id,
            turnId: activeTurn.id,
          });
        }
        tx.update(schema.runtimeSessions).set({ retiredAt: now, status: "disabled", updatedAt: now })
          .where(eq(schema.runtimeSessions.id, current.id)).run();
      }
      const latest = tx.select({ generation: schema.runtimeSessions.sessionGeneration })
        .from(schema.runtimeSessions).where(and(
          eq(schema.runtimeSessions.spaceId, address.spaceId),
          eq(schema.runtimeSessions.agentId, address.agentId),
          eq(schema.runtimeSessions.surfaceKind, address.surfaceKind),
          eq(schema.runtimeSessions.surfaceId, address.surfaceId),
        )).orderBy(desc(schema.runtimeSessions.sessionGeneration)).limit(1).get();
      const inserted: typeof schema.runtimeSessions.$inferInsert = {
        id: randomUUID(),
        spaceId: address.spaceId,
        agentId: address.agentId,
        surfaceKind: address.surfaceKind,
        surfaceId: address.surfaceId,
        sessionGeneration: (latest?.generation ?? 0) + 1,
        runtime: configuration.runtime,
        model: configuration.model ?? null,
        runtimeConfigFingerprint: fingerprint,
        adapterVersion: configuration.adapterVersion,
        engineHostFingerprint: configuration.engineHostFingerprint ?? null,
        workspaceRootFingerprint: configuration.workspaceRootFingerprint,
        status: "cold",
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
      };
      tx.insert(schema.runtimeSessions).values(inserted).run();
      return tx.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, inserted.id!)).get()!;
    });
  }

  acknowledgeEngineSession(input: {
    sessionId: string;
    sessionGeneration: number;
    engineSessionId: string;
    status?: "starting" | "idle" | "running" | "resume_failed";
  }): RuntimeSessionRecord {
    const current = this.db.select().from(schema.runtimeSessions)
      .where(eq(schema.runtimeSessions.id, input.sessionId)).get();
    if (!current || current.retiredAt || current.sessionGeneration !== input.sessionGeneration) {
      throw new HarnessError("session_generation_stale", "engine session acknowledgement targets a stale generation", input);
    }
    const now = new Date(this.now());
    this.db.update(schema.runtimeSessions).set({
      engineSessionId: input.engineSessionId,
      status: input.status ?? "idle",
      lastActiveAt: now,
      updatedAt: now,
    }).where(and(
      eq(schema.runtimeSessions.id, input.sessionId),
      eq(schema.runtimeSessions.sessionGeneration, input.sessionGeneration),
      isNull(schema.runtimeSessions.retiredAt),
    )).run();
    return this.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, input.sessionId)).get()!;
  }

  currentSession(address: RuntimeSessionKey): RuntimeSessionRecord | null {
    return this.db.select().from(schema.runtimeSessions).where(and(
      eq(schema.runtimeSessions.spaceId, address.spaceId),
      eq(schema.runtimeSessions.agentId, address.agentId),
      eq(schema.runtimeSessions.surfaceKind, address.surfaceKind),
      eq(schema.runtimeSessions.surfaceId, address.surfaceId),
      isNull(schema.runtimeSessions.retiredAt),
    )).get() ?? null;
  }

  retireAgentSessions(agentId: string): number {
    const now = new Date(this.now());
    return this.db.update(schema.runtimeSessions).set({ status: "disabled", retiredAt: now, updatedAt: now }).where(and(
      eq(schema.runtimeSessions.agentId, agentId),
      isNull(schema.runtimeSessions.retiredAt),
    )).run().changes;
  }
}
