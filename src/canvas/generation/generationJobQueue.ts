import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { SpaceDb } from "../../db/index.js";
import { canvasGenerationJobs } from "../../db/schema.js";
import type {
  CreateGenerationJobParams,
  GenerationJobRow,
  GenerationJobStatus,
  GenerationProvider,
  GenerationJobType,
} from "./contracts.js";

type GenerationJobRecord = typeof canvasGenerationJobs.$inferSelect;

function timestampMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

function toJobRow(record: GenerationJobRecord): GenerationJobRow {
  const createdAt = timestampMs(record.createdAt);
  const updatedAt = timestampMs(record.updatedAt);
  if (createdAt == null || updatedAt == null) {
    throw new Error(`canvas generation job ${record.id} is missing required timestamps`);
  }
  return {
    id: record.id,
    canvasId: record.canvasId,
    jobType: record.jobType as GenerationJobType,
    status: record.status as GenerationJobStatus,
    genPrompt: record.genPrompt,
    configJson: record.configJson,
    placementJson: record.placementJson,
    provider: record.provider as GenerationProvider,
    providerJobId: record.providerJobId,
    errorMessage: record.errorMessage,
    retryCount: record.retryCount,
    resultAssetId: record.resultAssetId,
    resultNodeId: record.resultNodeId,
    turnId: record.turnId,
    idempotencyKey: record.idempotencyKey,
    expectedRevision: record.expectedRevision,
    createdAt,
    startedAt: timestampMs(record.startedAt),
    completedAt: timestampMs(record.completedAt),
    updatedAt,
  };
}

export function createGenerationJob(
  db: SpaceDb,
  params: CreateGenerationJobParams,
): GenerationJobRow {
  const existing = db.select().from(canvasGenerationJobs).where(and(
    eq(canvasGenerationJobs.canvasId, params.canvasId),
    eq(canvasGenerationJobs.idempotencyKey, params.idempotencyKey),
  )).get();
  if (existing) return toJobRow(existing);

  const now = new Date();
  const inserted = db.insert(canvasGenerationJobs).values({
    id: randomUUID(),
    canvasId: params.canvasId,
    jobType: params.jobType,
    status: "pending",
    genPrompt: params.genPrompt,
    configJson: params.config ? JSON.stringify(params.config) : null,
    placementJson: JSON.stringify(params.placement),
    provider: params.provider,
    retryCount: 0,
    turnId: params.turnId ?? null,
    idempotencyKey: params.idempotencyKey,
    expectedRevision: params.expectedRevision,
    createdAt: now,
    updatedAt: now,
  }).returning().get();
  if (!inserted) throw new Error("failed to create canvas generation job");
  return toJobRow(inserted);
}

export function getGenerationJob(
  db: SpaceDb,
  jobId: string,
): GenerationJobRow | undefined {
  const row = db.select().from(canvasGenerationJobs).where(eq(canvasGenerationJobs.id, jobId)).get();
  return row ? toJobRow(row) : undefined;
}

export function listPendingJobs(
  db: SpaceDb,
  limit = 10,
): GenerationJobRow[] {
  const rows = db.select().from(canvasGenerationJobs)
    .where(eq(canvasGenerationJobs.status, "pending"))
    .orderBy(asc(canvasGenerationJobs.createdAt))
    .limit(limit)
    .all();
  return rows.map(toJobRow);
}

export function listProcessingJobs(
  db: SpaceDb,
): GenerationJobRow[] {
  const rows = db.select().from(canvasGenerationJobs)
    .where(eq(canvasGenerationJobs.status, "processing"))
    .all();
  return rows.map(toJobRow);
}

export function updateJobStatus(
  db: SpaceDb,
  jobId: string,
  updates: {
    status?: GenerationJobStatus;
    providerJobId?: string;
    errorMessage?: string;
    startedAt?: number;
    completedAt?: number;
    resultAssetId?: string;
    resultNodeId?: string;
  },
): void {
  const patch: Partial<typeof canvasGenerationJobs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.providerJobId !== undefined) patch.providerJobId = updates.providerJobId;
  if (updates.errorMessage !== undefined) patch.errorMessage = updates.errorMessage;
  if (updates.startedAt !== undefined) patch.startedAt = new Date(updates.startedAt);
  if (updates.completedAt !== undefined) patch.completedAt = new Date(updates.completedAt);
  if (updates.resultAssetId !== undefined) patch.resultAssetId = updates.resultAssetId;
  if (updates.resultNodeId !== undefined) patch.resultNodeId = updates.resultNodeId;
  db.update(canvasGenerationJobs).set(patch).where(eq(canvasGenerationJobs.id, jobId)).run();
}

export function incrementRetryCount(
  db: SpaceDb,
  jobId: string,
): void {
  const job = getGenerationJob(db, jobId);
  if (!job) return;
  db.update(canvasGenerationJobs).set({
    retryCount: job.retryCount + 1,
    status: "pending",
    updatedAt: new Date(),
  }).where(eq(canvasGenerationJobs.id, jobId)).run();
}
