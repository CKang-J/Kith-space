import { z } from "zod";

export const DeliveryDirectiveSchema = z.enum(["required", "optional", "observe"]);
export const DeliveryDispositionSchema = z.enum([
  "pending",
  "bound",
  "observed",
  "replied",
  "ceded",
  "dispatch_blocked",
  "dismissed",
]);

export const ResponsePolicySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  defaultMode: z.enum(["active", "mention_only", "silent"]),
  overrideMode: z.enum(["active", "mention_only", "silent"]).nullable(),
  effectiveMode: z.enum(["active", "mention_only", "silent"]),
  effectiveAtSeq: z.number().int().nonnegative(),
  reason: z.string().min(1),
}).strict();

export const AgentDeliveryItemSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  spaceId: z.string().min(1),
  agentId: z.string().min(1),
  messageId: z.string().min(1),
  sourceChannelId: z.string().min(1),
  sourceSeq: z.number().int().nonnegative(),
  cursorOwnerChannelId: z.string().min(1),
  targetSurfaceKind: z.enum(["channel", "private", "dm", "thread"]),
  targetSurfaceId: z.string().min(1),
  targetSessionId: z.string().min(1).nullable(),
  directive: DeliveryDirectiveSchema,
  reason: z.string().min(1),
  policySnapshot: ResponsePolicySnapshotSchema,
  disposition: DeliveryDispositionSchema,
  turnId: z.string().min(1).nullable(),
  dispatchWakeId: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  settledAt: z.number().int().nonnegative().nullable(),
}).strict();
export type AgentDeliveryItem = z.infer<typeof AgentDeliveryItemSchema>;
