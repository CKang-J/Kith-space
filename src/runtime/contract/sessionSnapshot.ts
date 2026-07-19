import { z } from "zod";

export const AdapterSnapshotSchema = z.object({
  schemaVersion: z.number().int().positive(),
  payload: z.record(z.unknown()),
}).strict();

export const RuntimeSessionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sessionGeneration: z.number().int().positive(),
  engineSessionId: z.string().min(1).max(4_096).nullable(),
  checklistRevision: z.number().int().nonnegative(),
  adapterSnapshot: AdapterSnapshotSchema.optional(),
  savedAt: z.number().int().nonnegative(),
}).strict();

export const WorkerSessionSnapshotReportSchema = z.object({
  schemaVersion: z.literal(1),
  spaceId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionGeneration: z.number().int().positive(),
  snapshotVersion: z.number().int().positive(),
  adapterSnapshot: AdapterSnapshotSchema,
  savedAt: z.number().int().nonnegative(),
}).strict();

export type RuntimeSessionSnapshot = z.infer<typeof RuntimeSessionSnapshotSchema>;
export type WorkerSessionSnapshotReport = z.infer<typeof WorkerSessionSnapshotReportSchema>;
