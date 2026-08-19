import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";
import type { CanvasMutationImpact } from "./canvasTypes.js";
import { isCanvasAgentExecutionEnabled } from "./canvasAgentExecution.js";

export const CANVAS_GRANT_ACTIONS = [
  "read_snapshot",
  "read_live",
  "write_existing",
  "create",
  "delete_existing",
  "import",
  "export",
  "set_canvas_background",
] as const;
export type CanvasGrantAction = (typeof CANVAS_GRANT_ACTIONS)[number];

export type CanvasGrantObjectScope = {
  snapshotId: string;
  canvasId: string;
  elementIds: string[];
  frameIds: string[];
  emptySelection: boolean;
  createParents: string[];
};

export type CanvasAccessGrantRow = typeof schema.canvasAccessGrants.$inferSelect;

export class CanvasAccessGrantError extends Error {
  constructor(
    public readonly code: "denied" | "expired" | "revoked" | "inactive",
    message: string,
  ) {
    super(message);
    this.name = "CanvasAccessGrantError";
  }
}

type SnapshotRow = typeof schema.canvasSelectionSnapshots.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function projectionFlags(snapshot: SnapshotRow): { wholeCanvas: boolean; groupIds: string[] } {
  const projection = asRecord(snapshot.projection);
  const wholeCanvas = projection?.wholeCanvas === true;
  const elements = Array.isArray(projection?.elements) ? projection.elements : [];
  const groupIds = elements.flatMap((item) => {
    const record = asRecord(item);
    return record && typeof record.id === "string" && record.key === "group" ? [record.id] : [];
  });
  return { wholeCanvas, groupIds };
}

/**
 * Product grants:
 * - empty / whole-canvas snapshot → live read/write/create on the whole Canvas (createParents includes ROOT + Frames)
 * - Frame selection → live read/write/create inside those Frames (createParents is the Frame ids, not ROOT)
 * - element-only selection → live read/write/create; ROOT remains a valid parent
 *
 * `set_canvas_background` is signed only for whole-canvas grants. Partial selections
 * must not silently receive a document-wide background write.
 */
function defaultActions(emptySelection: boolean): CanvasGrantAction[] {
  const write: CanvasGrantAction[] = ["read_snapshot", "read_live", "write_existing", "create", "delete_existing", "import", "export"];
  if (emptySelection) return [...write, "set_canvas_background"];
  return write;
}

export function buildCanvasGrantObjectScope(snapshot: SnapshotRow): CanvasGrantObjectScope {
  const { wholeCanvas, groupIds } = projectionFlags(snapshot);
  const elementIds = snapshot.selectedElements.map((item) => item.id);
  const frameIds = snapshot.selectedFrames.map((item) => item.id);
  const emptySelection = wholeCanvas || (elementIds.length === 0 && frameIds.length === 0);
  const createParents = emptySelection
    ? [...new Set(["ROOT", ...frameIds, ...groupIds])]
    : frameIds.length
      ? [...new Set([...frameIds, ...groupIds])]
      : [...new Set(["ROOT", ...groupIds])];
  return {
    snapshotId: snapshot.id,
    canvasId: snapshot.canvasId,
    elementIds,
    frameIds,
    emptySelection,
    createParents,
  };
}

function allowsRootChildMutation(
  scope: CanvasGrantObjectScope,
  grant: CanvasAccessGrantRow,
  createdElements: Set<string>,
  deletedElements: Set<string>,
): boolean {
  if (scope.createParents.includes("ROOT")) return true;
  if (scope.frameIds.length === 0) return false;
  if (createdElements.size > 0 && grant.actions.includes("create")) return true;
  if (deletedElements.size > 0 && grant.actions.includes("delete_existing")) return true;
  return false;
}

export function prepareCanvasAccessGrantsInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    turnId: string;
    executorAgentId: string;
    deliveries: Array<typeof schema.agentDeliveryItems.$inferSelect>;
    expiresAt: Date;
  },
): CanvasAccessGrantRow[] {
  if (!isCanvasAgentExecutionEnabled()) return [];
  const existing = tx.select().from(schema.canvasAccessGrants).where(and(
    eq(schema.canvasAccessGrants.turnId, input.turnId),
    eq(schema.canvasAccessGrants.executorAgentId, input.executorAgentId),
  )).all();
  if (existing.length) return existing;

  const required = input.deliveries.filter((delivery) =>
    delivery.disposition === "bound"
    && delivery.directive === "required"
    && delivery.agentId === input.executorAgentId
    && delivery.turnId === input.turnId,
  );
  if (!required.length) return [];
  const messageIds = [...new Set(required.map((delivery) => delivery.messageId))];
  const bindings = tx.select().from(schema.messageExecutionBindings)
    .where(inArray(schema.messageExecutionBindings.messageId, messageIds)).all();
  const bindingByMessage = new Map(bindings.map((row) => [row.messageId, row]));
  const snapshots = tx.select().from(schema.canvasSelectionSnapshots)
    .where(inArray(schema.canvasSelectionSnapshots.messageId, messageIds)).all();
  const created: CanvasAccessGrantRow[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.messageId) continue;
    const binding = bindingByMessage.get(snapshot.messageId);
    if (!binding || binding.executorAgentId !== input.executorAgentId) continue;
    const delivery = required.find((item) => item.messageId === snapshot.messageId);
    if (!delivery) continue;
    const objectScope = buildCanvasGrantObjectScope(snapshot);
    const grant = tx.insert(schema.canvasAccessGrants).values({
      id: randomUUID(),
      spaceId: input.spaceId,
      messageId: snapshot.messageId,
      snapshotId: snapshot.id,
      deliveryId: delivery.id,
      turnId: input.turnId,
      executorAgentId: input.executorAgentId,
      canvasId: snapshot.canvasId,
      objectScope,
      actions: defaultActions(objectScope.emptySelection),
      expiresAt: input.expiresAt,
    }).returning().get();
    created.push(grant);
  }
  return created;
}

export function listCanvasAccessGrantsInTransaction(
  tx: SpaceTransaction,
  turnId: string,
  executorAgentId: string,
): CanvasAccessGrantRow[] {
  return tx.select().from(schema.canvasAccessGrants).where(and(
    eq(schema.canvasAccessGrants.turnId, turnId),
    eq(schema.canvasAccessGrants.executorAgentId, executorAgentId),
  )).all();
}

export function revokeCanvasAccessGrantsForAgentInTransaction(
  tx: SpaceTransaction,
  agentId: string,
  now = new Date(),
): void {
  tx.update(schema.canvasAccessGrants).set({ revokedAt: now }).where(and(
    eq(schema.canvasAccessGrants.executorAgentId, agentId),
    isNull(schema.canvasAccessGrants.revokedAt),
  )).run();
}

export function revokeCanvasAccessGrantsForCanvasInTransaction(
  tx: SpaceTransaction,
  canvasId: string,
  now = new Date(),
): void {
  tx.update(schema.canvasAccessGrants).set({ revokedAt: now }).where(and(
    eq(schema.canvasAccessGrants.canvasId, canvasId),
    isNull(schema.canvasAccessGrants.revokedAt),
  )).run();
}

export function resolveCanvasAccessGrantInTransaction(
  tx: SpaceTransaction,
  input: {
    turnId: string;
    executorAgentId: string;
    requestedCanvasId?: string;
    requestedSnapshotId?: string;
  },
): CanvasAccessGrantRow {
  const grants = listCanvasAccessGrantsInTransaction(tx, input.turnId, input.executorAgentId);
  if (!grants.length) throw new CanvasAccessGrantError("denied", "no Canvas access grant is bound to this turn");
  if (input.requestedSnapshotId) {
    const match = grants.find((grant) => grant.snapshotId === input.requestedSnapshotId);
    if (!match) throw new CanvasAccessGrantError("denied", "snapshotId is outside the current Canvas grant");
    if (input.requestedCanvasId && match.canvasId !== input.requestedCanvasId) {
      throw new CanvasAccessGrantError("denied", "canvasId does not match the authorized snapshot");
    }
    return match;
  }
  const byCanvas = input.requestedCanvasId
    ? grants.filter((grant) => grant.canvasId === input.requestedCanvasId)
    : grants;
  if (input.requestedCanvasId && !byCanvas.length) {
    throw new CanvasAccessGrantError("denied", "canvasId is outside the current Canvas grant");
  }
  const canvasIds = new Set(byCanvas.map((grant) => grant.canvasId));
  if (canvasIds.size !== 1) {
    throw new CanvasAccessGrantError("denied", "Canvas write is limited to one authorized Canvas");
  }
  if (byCanvas.length !== 1) {
    throw new CanvasAccessGrantError(
      "denied",
      "multiple Canvas access grants match; snapshotId is required to select one",
    );
  }
  return byCanvas[0]!;
}

export function assertLiveCanvasAccessGrant(
  tx: SpaceTransaction,
  grant: CanvasAccessGrantRow,
  input: {
    executorAgentId: string;
    now: number;
    actions: readonly CanvasGrantAction[];
    allowDeletedCanvas?: boolean;
    requestedElementIds?: string[];
    requestedFrameIds?: string[];
  },
): { canvasDeleted: boolean; snapshot: SnapshotRow } {
  if (grant.executorAgentId !== input.executorAgentId) {
    throw new CanvasAccessGrantError("denied", "Canvas grant executor does not match the current Agent");
  }
  if (grant.revokedAt) throw new CanvasAccessGrantError("revoked", "Canvas access grant has been revoked");
  if (grant.expiresAt.getTime() <= input.now) throw new CanvasAccessGrantError("expired", "Canvas access grant has expired");
  const agent = tx.select({ id: schema.agents.id, deletedAt: schema.agents.deletedAt }).from(schema.agents).where(eq(schema.agents.id, grant.executorAgentId)).get();
  if (!agent || agent.deletedAt) throw new CanvasAccessGrantError("revoked", "executor Agent is no longer available");
  const snapshot = tx.select().from(schema.canvasSelectionSnapshots).where(eq(schema.canvasSelectionSnapshots.id, grant.snapshotId)).get();
  if (!snapshot || snapshot.canvasId !== grant.canvasId) {
    throw new CanvasAccessGrantError("denied", "authorized Canvas snapshot is unavailable");
  }
  const canvas = tx.select({ id: schema.canvasDocuments.id, deletedAt: schema.canvasDocuments.deletedAt })
    .from(schema.canvasDocuments).where(eq(schema.canvasDocuments.id, grant.canvasId)).get();
  const canvasDeleted = !canvas || Boolean(canvas.deletedAt);
  if (canvasDeleted && !input.allowDeletedCanvas) {
    throw new CanvasAccessGrantError("inactive", "live Canvas grant is invalid after Canvas deletion");
  }
  for (const action of input.actions) {
    if (!grant.actions.includes(action)) {
      throw new CanvasAccessGrantError("denied", `Canvas grant does not allow ${action}`);
    }
  }
  const scope = grant.objectScope;
  for (const elementId of input.requestedElementIds ?? []) {
    if (!scope.elementIds.includes(elementId)) {
      throw new CanvasAccessGrantError("denied", "elementId is outside the authorized Canvas grant");
    }
  }
  for (const frameId of input.requestedFrameIds ?? []) {
    if (!scope.frameIds.includes(frameId)) {
      throw new CanvasAccessGrantError("denied", "frameId is outside the authorized Canvas grant");
    }
  }
  return { canvasDeleted, snapshot };
}

export function authorizeCanvasMutationImpact(
  grant: CanvasAccessGrantRow,
  impact: CanvasMutationImpact,
  meta: {
    createdElementIds?: string[];
    createdFrameIds?: string[];
    deletedElementIds?: string[];
    deletedFrameIds?: string[];
    reorderedElementIds?: string[];
    reorderedFrameIds?: string[];
    confirmDestructive?: boolean;
  } = {},
): void {
  const scope = grant.objectScope;
  if (scope.emptySelection && !grant.actions.includes("create") && !grant.actions.includes("write_existing")) {
    // Explicitly injected read-only / background-only grants stay fail-closed.
    if (!grant.actions.includes("set_canvas_background")) {
      throw new CanvasAccessGrantError("denied", "whole-canvas snapshot grants are read-only");
    }
    for (const resource of impact.writeResources) {
      if (resource !== "document:background") {
        throw new CanvasAccessGrantError("denied", "whole-canvas write grant only allows set_canvas_background");
      }
    }
    if (!impact.writeResources.includes("document:background")) {
      throw new CanvasAccessGrantError("denied", "whole-canvas write grant only allows set_canvas_background");
    }
    return;
  }
  const createdElements = new Set(meta.createdElementIds ?? []);
  const createdFrames = new Set(meta.createdFrameIds ?? []);
  const deletedElements = new Set(meta.deletedElementIds ?? []);
  const deletedFrames = new Set(meta.deletedFrameIds ?? []);
  const reorderedElements = new Set(meta.reorderedElementIds ?? []);
  const reorderedFrames = new Set(meta.reorderedFrameIds ?? []);
  if ((deletedElements.size || deletedFrames.size) && !meta.confirmDestructive) {
    throw new CanvasAccessGrantError("denied", "destructive Canvas operations require confirmDestructive");
  }
  if ((deletedElements.size || deletedFrames.size) && !grant.actions.includes("delete_existing")) {
    throw new CanvasAccessGrantError("denied", "Canvas grant does not allow delete_existing");
  }
  for (const id of deletedElements) {
    if (scope.elementIds.includes(id) || createdElements.has(id)) continue;
    throw new CanvasAccessGrantError("denied", "cannot delete an element outside the grant");
  }
  for (const id of deletedFrames) {
    if (scope.frameIds.includes(id) || createdFrames.has(id)) continue;
    throw new CanvasAccessGrantError("denied", "cannot delete a Frame outside the grant");
  }
  if (createdElements.size || createdFrames.size) {
    if (!grant.actions.includes("create")) throw new CanvasAccessGrantError("denied", "Canvas grant does not allow create");
  }
  if (reorderedElements.size || reorderedFrames.size) {
    if (!grant.actions.includes("write_existing")) {
      throw new CanvasAccessGrantError("denied", "Canvas grant does not allow write_existing");
    }
    for (const id of reorderedElements) {
      if (!scope.elementIds.includes(id)) {
        throw new CanvasAccessGrantError("denied", `cannot reorder element ${id} outside the grant`);
      }
    }
    for (const id of reorderedFrames) {
      if (!scope.frameIds.includes(id)) {
        throw new CanvasAccessGrantError("denied", `cannot reorder Frame ${id} outside the grant`);
      }
    }
  }

  const authorizedRead = new Set<string>([
    ...scope.elementIds.map((id) => `element:${id}`),
    ...scope.frameIds.map((id) => `frame:${id}`),
    ...[...createdElements].map((id) => `element:${id}`),
    ...[...createdFrames].map((id) => `frame:${id}`),
  ]);
  const writingOrder = impact.writeResources.includes("structure:order");
  for (const resource of impact.readResources) {
    if (resource.startsWith("element:") || resource.startsWith("frame:")) {
      // Ambient stack neighbors may appear in stackOrder reads when authorized
      // nodes are reordered; only explicitly reordered / otherwise authorized
      // objects require grant membership.
      if (writingOrder) {
        const id = resource.startsWith("element:") ? resource.slice("element:".length) : resource.slice("frame:".length);
        const isTargeted = resource.startsWith("element:")
          ? reorderedElements.has(id)
          : reorderedFrames.has(id);
        if (!isTargeted && !authorizedRead.has(resource)) continue;
      }
      if (!authorizedRead.has(resource)) {
        throw new CanvasAccessGrantError("denied", `read impact ${resource} is outside the Canvas grant`);
      }
    }
  }

  const writesExisting = (impact.elementIds.some((id) => !createdElements.has(id) && !deletedElements.has(id) && scope.elementIds.includes(id))
    || impact.frameIds.some((id) => !createdFrames.has(id) && !deletedFrames.has(id) && scope.frameIds.includes(id)));
  if (writesExisting && !grant.actions.includes("write_existing")) {
    throw new CanvasAccessGrantError("denied", "Canvas grant does not allow write_existing");
  }

  for (const resource of impact.writeResources) {
    if (resource === "metadata:title" || resource === "metadata:lifecycle") {
      throw new CanvasAccessGrantError("denied", "Canvas grant does not allow metadata mutations");
    }
    if (resource === "document:background" || resource.startsWith("document:")) {
      if (resource === "document:background" && grant.actions.includes("set_canvas_background")) continue;
      throw new CanvasAccessGrantError("denied", `write impact ${resource} is outside the Canvas grant`);
    }
    if (resource === "structure:active-frame") {
      throw new CanvasAccessGrantError("denied", `write impact ${resource} is outside the Canvas grant`);
    }
    if (resource === "structure:root") {
      const childrenRoot = impact.writeResources.includes("children:ROOT");
      const creating = createdElements.size > 0 && grant.actions.includes("create") && allowsRootChildMutation(scope, grant, createdElements, deletedElements);
      const deleting = deletedElements.size > 0 && grant.actions.includes("delete_existing") && allowsRootChildMutation(scope, grant, createdElements, deletedElements);
      if (childrenRoot && (creating || deleting)) continue;
      throw new CanvasAccessGrantError("denied", `write impact ${resource} is outside the Canvas grant`);
    }
    if (resource === "structure:order" || resource === "structure:frames") continue;
    if (resource.startsWith("element:")) {
      const id = resource.slice("element:".length);
      if (createdElements.has(id)) continue;
      if (deletedElements.has(id) && scope.elementIds.includes(id)) continue;
      if (scope.elementIds.includes(id)) continue;
      throw new CanvasAccessGrantError("denied", `cannot write element ${id} outside the grant`);
    }
    if (resource.startsWith("frame:")) {
      const id = resource.slice("frame:".length);
      if (createdFrames.has(id)) continue;
      if (deletedFrames.has(id) && scope.frameIds.includes(id)) continue;
      if (scope.frameIds.includes(id)) continue;
      throw new CanvasAccessGrantError("denied", `cannot write Frame ${id} outside the grant`);
    }
    if (resource.startsWith("children:")) {
      const parent = resource.slice("children:".length);
      if (parent === "ROOT" && allowsRootChildMutation(scope, grant, createdElements, deletedElements)) continue;
      if (scope.createParents.includes(parent) || scope.elementIds.includes(parent) || createdElements.has(parent)) continue;
      throw new CanvasAccessGrantError("denied", `cannot change children of ${parent} outside the grant`);
    }
    if (resource.startsWith("parent:")) {
      const id = resource.slice("parent:".length);
      if (createdElements.has(id) || scope.elementIds.includes(id) || deletedElements.has(id)) continue;
      // Appending/removing a ROOT child rewrites ROOT.children; Core then emits
      // parent: writes for every sibling. Those ambient siblings are not in-scope.
      if (
        impact.writeResources.includes("children:ROOT")
        && allowsRootChildMutation(scope, grant, createdElements, deletedElements)
        && (createdElements.size > 0 || deletedElements.size > 0)
      ) continue;
      throw new CanvasAccessGrantError("denied", `cannot reparent ${id} outside the grant`);
    }
    if (resource.startsWith("frame-membership:")) {
      const id = resource.slice("frame-membership:".length);
      if (scope.elementIds.includes(id) || scope.frameIds.includes(id) || createdElements.has(id) || createdFrames.has(id) || deletedElements.has(id) || deletedFrames.has(id)) {
        continue;
      }
      throw new CanvasAccessGrantError("denied", `cannot change Frame membership for ${id} outside the grant`);
    }
  }
}

/** After a successful create, the same turn may update/delete those new ids. */
export function expandCanvasAccessGrantAfterCreateInTransaction(
  tx: SpaceTransaction,
  grant: CanvasAccessGrantRow,
  created: { elementIds?: string[]; frameIds?: string[] },
): void {
  const elementIds = created.elementIds?.filter(Boolean) ?? [];
  const frameIds = created.frameIds?.filter(Boolean) ?? [];
  if (!elementIds.length && !frameIds.length) return;
  const scope = grant.objectScope;
  tx.update(schema.canvasAccessGrants).set({
    objectScope: {
      ...scope,
      elementIds: [...new Set([...scope.elementIds, ...elementIds])],
      frameIds: [...new Set([...scope.frameIds, ...frameIds])],
      createParents: [...new Set([...scope.createParents, ...frameIds])],
    },
  }).where(eq(schema.canvasAccessGrants.id, grant.id)).run();
}
