import { and, eq, isNull } from "drizzle-orm";
import type { SpaceDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { createLogger } from "../../log.js";
import { publish } from "../../server/realtime.js";
import { expandCanvasAccessGrantAfterCreateInTransaction } from "../canvasAccessGrant.js";
import { CanvasAssetStore } from "../canvasAssetStore.js";
import { CanvasCore } from "../canvasCore.js";
import { durableCanvasAssetSrc, mapCanvasToolOps } from "../canvasToolOps.js";
import type { CanvasJson } from "../canvasTypes.js";
import type { GenerationJobConfig, GenerationJobPlacement, GenerationJobRow } from "./contracts.js";
import { encodeArkUrlJobId } from "./arkClient.js";
import { importGeneratedAsset, sniffGeneratedMime } from "./generationAssetImport.js";
import { getGenerationProvider } from "./generationProviders.js";
import {
  getGenerationJob,
  incrementRetryCount,
  listPendingJobs,
  listProcessingJobs,
  updateJobStatus,
} from "./generationJobQueue.js";

const log = createLogger("canvas-generation");
const POLL_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;

export class GenerationWorker {
  private isRunning = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private pollAgain = false;

  constructor(
    private readonly db: SpaceDb,
    private readonly spaceId: string,
    private readonly spaceRoot: string,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    void this.pollOnce().finally(() => this.schedulePoll());
  }

  stop(): void {
    this.isRunning = false;
    this.pollAgain = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    try {
      do {
        this.pollAgain = false;
        for (const job of listPendingJobs(this.db, 5)) {
          await this.processPendingJob(job);
        }
        for (const job of listProcessingJobs(this.db)) {
          await this.checkProcessingJob(job);
        }
      } while (this.pollAgain && this.isRunning);
    } catch (error) {
      log.error("generation poll failed", { spaceId: this.spaceId, detail: String((error as Error)?.message ?? error) });
    } finally {
      this.polling = false;
    }
  }

  private schedulePoll(): void {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(() => {
      this.pollOnce().finally(() => this.schedulePoll());
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private async processPendingJob(job: GenerationJobRow): Promise<void> {
    const provider = getGenerationProvider(job.provider);
    if (!provider) {
      await this.handleJobFailure(job, `Provider ${job.provider} is not available`);
      return;
    }
    try {
      const config = parseConfig(job.configJson);
      const referenceImage = this.readReferenceImage(job, config);
      const providerJobId = await provider.submit({
        prompt: job.genPrompt,
        config,
        referenceImage,
      });
      updateJobStatus(this.db, job.id, {
        status: "processing",
        providerJobId,
        startedAt: Date.now(),
      });
      const processing = getGenerationJob(this.db, job.id);
      if (processing) await this.checkProcessingJob(processing);
    } catch (error) {
      await this.handleJobFailure(job, String((error as Error)?.message ?? error));
    }
  }

  private async checkProcessingJob(job: GenerationJobRow): Promise<void> {
    const provider = getGenerationProvider(job.provider);
    if (!provider || !job.providerJobId) return;
    try {
      const status = await provider.getStatus(job.providerJobId);
      if (status.status === "completed") {
        const durableJobId = encodeArkUrlJobId(status.resultUrl);
        if (durableJobId !== job.providerJobId) {
          updateJobStatus(this.db, job.id, { providerJobId: durableJobId });
        }
        const bytes = await provider.downloadResult(durableJobId);
        await this.completeJob(job, bytes);
        return;
      }
      if (status.status === "failed") {
        await this.handleJobFailure(job, status.error);
      }
    } catch (error) {
      await this.handleJobFailure(job, String((error as Error)?.message ?? error));
    }
  }

  private async completeJob(job: GenerationJobRow, bytes: Buffer): Promise<void> {
    const existing = getGenerationJob(this.db, job.id);
    const assetId = existing?.resultAssetId ?? await importGeneratedAsset(this.db, this.spaceId, this.spaceRoot, {
      canvasId: job.canvasId,
      bytes,
      jobId: job.id,
      mimeType: sniffGeneratedMime(bytes, job.jobType),
    });
    if (!existing?.resultAssetId) {
      updateJobStatus(this.db, job.id, { resultAssetId: assetId });
    }
    const placement = parsePlacement(job.placementJson);
    if (placement.skipNodeCreate) {
      updateJobStatus(this.db, job.id, {
        status: "completed",
        resultAssetId: assetId,
        completedAt: Date.now(),
      });
      return;
    }
    const snapshot = this.placeMediaNode(job, assetId, placement);
    const nodeId = snapshot.nodeId;
    updateJobStatus(this.db, job.id, {
      status: "completed",
      resultAssetId: assetId,
      resultNodeId: nodeId,
      completedAt: Date.now(),
    });
    void publish(this.spaceId, {
      type: "canvas:changed",
      canvasId: job.canvasId,
      sequence: snapshot.sequence,
      revision: snapshot.revision,
    }).catch((error) => {
      log.error("failed to publish canvas:changed after generation", { detail: String((error as Error)?.message ?? error) });
    });
  }

  private placeMediaNode(
    job: GenerationJobRow,
    assetId: string,
    placement: GenerationJobPlacement,
  ): { nodeId: string; sequence: number; revision: number } {
    const promoted = this.promoteMediaNode(job, assetId, placement);
    if (promoted) return promoted;
    return this.createMediaNode(job, assetId, placement);
  }

  private promoteMediaNode(
    job: GenerationJobRow,
    assetId: string,
    placement: GenerationJobPlacement,
  ): { nodeId: string; sequence: number; revision: number } | null {
    const targetId = placement.targetNodeId?.trim();
    if (!targetId) return null;
    const core = new CanvasCore(this.db, this.spaceId);
    const live = core.read(job.canvasId);
    const nodes = asNodeMap(live.document);
    const existing = nodes[targetId];
    const expectedKey = job.jobType === "video" ? "video" : "image";
    if (!existing || String(existing.key) !== expectedKey) return null;
    const next = structuredClone(existing) as Record<string, CanvasJson>;
    next.assetId = assetId;
    const attrs = isRecord(next.attrs) ? { ...next.attrs } : {};
    for (const key of GENERATOR_ATTRS) delete attrs[key];
    const src = durableCanvasAssetSrc(this.spaceId, job.canvasId, assetId);
    attrs.src = src;
    attrs.uploadKey = assetId;
    attrs.assetId = assetId;
    attrs.assetKind = expectedKey;
    if (expectedKey === "image" && typeof attrs.mode !== "string") attrs.mode = "FIT";
    if (job.genPrompt) attrs.genPrompt = job.genPrompt;
    if (placement.name && typeof attrs.name !== "string") attrs.name = placement.name;
    next.attrs = attrs;
    const snapshot = core.apply({
      canvasId: job.canvasId,
      operationId: `generation:${job.id}`,
      expectedRevision: live.revisions.revision,
      operation: {
        type: "document.patch",
        patches: [{ op: "set", path: ["deltaSetLike", targetId], value: next }],
      },
    });
    return { nodeId: targetId, sequence: snapshot.sequence, revision: snapshot.revisions.revision };
  }

  private createMediaNode(
    job: GenerationJobRow,
    assetId: string,
    placement: GenerationJobPlacement,
  ): { nodeId: string; sequence: number; revision: number } {
    const core = new CanvasCore(this.db, this.spaceId);
    const live = core.read(job.canvasId);
    const mapped = mapCanvasToolOps(live.document as CanvasJson, [{
      op: job.jobType === "video" ? "create_video" : "create_image",
      id: placement.customId,
      assetId,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      parentId: placement.parentId,
      frameId: placement.frameId,
      attrs: placement.name ? { name: placement.name } : undefined,
    }], { spaceId: this.spaceId, canvasId: job.canvasId });
    if (!mapped.operation) {
      throw new Error("generation result did not produce a Canvas operation");
    }
    const snapshot = core.apply({
      canvasId: job.canvasId,
      operationId: `generation:${job.id}`,
      expectedRevision: live.revisions.revision,
      operation: mapped.operation,
    });
    this.expandGrantAfterCreate(job, mapped.createdElementIds);
    const nodeId = mapped.createdElementIds[0];
    if (!nodeId) throw new Error("generation result did not create a Canvas node");
    return { nodeId, sequence: snapshot.sequence, revision: snapshot.revisions.revision };
  }

  private expandGrantAfterCreate(job: GenerationJobRow, elementIds: string[]): void {
    if (!job.turnId || elementIds.length === 0) return;
    const now = Date.now();
    this.db.transaction((tx) => {
      const grant = tx.select().from(schema.canvasAccessGrants).where(and(
        eq(schema.canvasAccessGrants.turnId, job.turnId!),
        eq(schema.canvasAccessGrants.canvasId, job.canvasId),
        isNull(schema.canvasAccessGrants.revokedAt),
      )).get();
      if (!grant) return;
      const expiresAt = grant.expiresAt instanceof Date ? grant.expiresAt.getTime() : Number(grant.expiresAt);
      if (expiresAt <= now) return;
      expandCanvasAccessGrantAfterCreateInTransaction(tx, grant, { elementIds });
    });
  }

  private readReferenceImage(job: GenerationJobRow, config: GenerationJobConfig | undefined): Buffer | undefined {
    if (!config?.referenceAssetId) return undefined;
    const store = new CanvasAssetStore(this.db, this.spaceId, this.spaceRoot);
    return store.read(job.canvasId, config.referenceAssetId).bytes;
  }

  private async handleJobFailure(job: GenerationJobRow, error: string): Promise<void> {
    if (job.retryCount < MAX_RETRIES) {
      log.warn("generation job retrying", {
        jobId: job.id,
        attempt: job.retryCount + 1,
        detail: error,
      });
      incrementRetryCount(this.db, job.id);
      return;
    }
    log.error("generation job failed", { jobId: job.id, detail: error });
    updateJobStatus(this.db, job.id, {
      status: "failed",
      errorMessage: error,
      completedAt: Date.now(),
    });
  }
}

function parseConfig(raw: string | null): GenerationJobConfig | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as GenerationJobConfig;
  } catch {
    return undefined;
  }
}

function parsePlacement(raw: string): GenerationJobPlacement {
  return JSON.parse(raw) as GenerationJobPlacement;
}

const GENERATOR_ATTRS = [
  "imageGenerator",
  "imageGenAspect",
  "imageGenResolution",
  "imageGenCount",
  "imageGenModel",
  "videoGenerator",
  "videoGenAspect",
  "videoGenResolution",
  "videoGenDuration",
  "videoGenModel",
  "processStatus",
  "processKind",
  "processLabel",
  "processSourceId",
  "processTargetWidth",
  "processTargetHeight",
  "processMeta",
  "imageVariants",
] as const;

function isRecord(value: unknown): value is Record<string, CanvasJson> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNodeMap(document: unknown): Record<string, Record<string, CanvasJson> & { key?: string }> {
  const root = isRecord(document) ? document.deltaSetLike : undefined;
  if (!isRecord(root)) return {};
  const nodes: Record<string, Record<string, CanvasJson> & { key?: string }> = {};
  for (const [id, value] of Object.entries(root)) {
    if (isRecord(value)) nodes[id] = value as Record<string, CanvasJson> & { key?: string };
  }
  return nodes;
}
