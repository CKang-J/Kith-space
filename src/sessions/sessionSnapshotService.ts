import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import {
  RuntimeSessionSnapshotSchema,
  WorkerSessionSnapshotReportSchema,
  type RuntimeSessionSnapshot,
  type WorkerSessionSnapshotReport,
} from "../runtime/contract/sessionSnapshot.js";
import { canonicalJson } from "../memory/memoryIntegrity.js";
import { containsSecretShapedText } from "../memory/secretDetection.js";

const MAX_SNAPSHOT_BYTES = 64 * 1024;
const FORBIDDEN_KEY = /(?:transcript|tool[_-]?(?:stdout|output)|context[_-]?envelope|raw[_-]?prompt|secret|credential)/iu;

export function assertTerminalSnapshotIdentity(
  report: WorkerSessionSnapshotReport,
  target: { spaceId: string; sessionId: string; sessionGeneration: number },
): void {
  if (report.spaceId !== target.spaceId || report.sessionId !== target.sessionId || report.sessionGeneration !== target.sessionGeneration) {
    throw new HarnessError("snapshot_generation_stale", "terminal snapshot identity does not match the logical turn", {
      expected: target,
      actual: { spaceId: report.spaceId, sessionId: report.sessionId, sessionGeneration: report.sessionGeneration },
    });
  }
}

function checksum(snapshot: RuntimeSessionSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function sameWorkerSnapshot(current: unknown, next: RuntimeSessionSnapshot): boolean {
  const parsed = RuntimeSessionSnapshotSchema.safeParse(current);
  return parsed.success
    && parsed.data.sessionGeneration === next.sessionGeneration
    && parsed.data.savedAt === next.savedAt
    && canonicalJson(parsed.data.adapterSnapshot ?? null) === canonicalJson(next.adapterSnapshot ?? null);
}

function validateAdapterValue(value: unknown, key = "adapterSnapshot"): void {
  if (FORBIDDEN_KEY.test(key)) throw new HarnessError("snapshot_generation_stale", "snapshot contains a forbidden recovery field", { key });
  if (typeof value === "string") {
    if (containsSecretShapedText([value])) throw new HarnessError("snapshot_generation_stale", "snapshot contains credential-shaped text");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => validateAdapterValue(entry, key));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) validateAdapterValue(child, childKey);
  }
}

/** Core-owned integrity gate for bounded, non-authoritative runtime recovery snapshots. */
export class SessionSnapshotService {
  constructor(private readonly spaceId: string, private readonly db: SpaceDb = dbForSpace(spaceId)) {}

  persist(raw: WorkerSessionSnapshotReport): { persisted: boolean; snapshotVersion: number } {
    const report = WorkerSessionSnapshotReportSchema.parse(raw);
    if (report.spaceId !== this.spaceId) throw new HarnessError("snapshot_generation_stale", "snapshot Space does not match the Core target");
    if (Buffer.byteLength(JSON.stringify(report.adapterSnapshot), "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new HarnessError("context_capacity_exhausted", "adapter snapshot exceeds the recovery payload limit");
    }
    validateAdapterValue(report.adapterSnapshot.payload);
    return this.db.transaction((tx) => {
      const session = tx.select().from(schema.runtimeSessions).where(and(
        eq(schema.runtimeSessions.id, report.sessionId),
        eq(schema.runtimeSessions.spaceId, this.spaceId),
        isNull(schema.runtimeSessions.retiredAt),
      )).get();
      if (!session || session.sessionGeneration !== report.sessionGeneration) {
        throw new HarnessError("snapshot_generation_stale", "snapshot targets a stale session generation", {
          sessionId: report.sessionId,
          sessionGeneration: report.sessionGeneration,
        });
      }
      const snapshot = RuntimeSessionSnapshotSchema.parse({
        schemaVersion: 1,
        sessionGeneration: session.sessionGeneration,
        engineSessionId: session.engineSessionId,
        checklistRevision: session.checklistRevision,
        adapterSnapshot: report.adapterSnapshot,
        savedAt: report.savedAt,
      });
      const nextChecksum = checksum(snapshot);
      if (report.snapshotVersion < session.snapshotVersion) {
        throw new HarnessError("snapshot_generation_stale", "snapshot version moved backwards", {
          currentVersion: session.snapshotVersion,
          receivedVersion: report.snapshotVersion,
        });
      }
      if (report.snapshotVersion === session.snapshotVersion) {
        // snapshotVersion belongs to the Worker adapter report. Core-owned engine/checklist state may
        // advance independently after the report was persisted, so it cannot turn a true retry into
        // a conflicting payload.
        if (sameWorkerSnapshot(session.snapshot, snapshot)) return { persisted: false, snapshotVersion: session.snapshotVersion };
        throw new HarnessError("snapshot_generation_stale", "snapshot version was reused with different content");
      }
      const updated = tx.update(schema.runtimeSessions).set({
        snapshotVersion: report.snapshotVersion,
        snapshot,
        snapshotChecksum: nextChecksum,
        snapshotSavedAt: new Date(report.savedAt),
        updatedAt: new Date(),
      }).where(and(
        eq(schema.runtimeSessions.id, session.id),
        eq(schema.runtimeSessions.sessionGeneration, report.sessionGeneration),
        eq(schema.runtimeSessions.snapshotVersion, session.snapshotVersion),
        isNull(schema.runtimeSessions.retiredAt),
      )).run();
      if (!updated.changes) throw new HarnessError("snapshot_generation_stale", "snapshot lost a concurrent version race");
      return { persisted: true, snapshotVersion: report.snapshotVersion };
    });
  }

  load(sessionId: string): RuntimeSessionSnapshot | null {
    const session = this.db.select().from(schema.runtimeSessions).where(and(
      eq(schema.runtimeSessions.id, sessionId), eq(schema.runtimeSessions.spaceId, this.spaceId),
    )).get();
    if (!session?.snapshot || !session.snapshotChecksum) return null;
    const parsed = RuntimeSessionSnapshotSchema.safeParse(session.snapshot);
    if (parsed.success
      && parsed.data.sessionGeneration === session.sessionGeneration
      && checksum(parsed.data) === session.snapshotChecksum) {
      try {
        if (parsed.data.adapterSnapshot) {
          if (Buffer.byteLength(JSON.stringify(parsed.data.adapterSnapshot), "utf8") > MAX_SNAPSHOT_BYTES) throw new Error("oversized snapshot");
          validateAdapterValue(parsed.data.adapterSnapshot.payload);
        }
        return {
          ...parsed.data,
          // Checklist rows + the session collection revision are authoritative. A valid older adapter
          // snapshot may be restored after later checklist edits, but must never move its revision back.
          checklistRevision: Math.max(parsed.data.checklistRevision, session.checklistRevision),
        };
      } catch {
        // Legacy or tampered recovery payloads fail open to authoritative session state below.
      }
    }
    this.db.update(schema.runtimeSessions).set({ snapshot: null, snapshotChecksum: null, snapshotSavedAt: null })
      .where(eq(schema.runtimeSessions.id, sessionId)).run();
    return null;
  }
}
