import { and, count, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import {
  getHumanProfile,
  getSpaceRecord,
  getSpaceRecordBySlug,
  listSpaceRecords,
  registerSpace as persistSpaceRecord,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { dbForSpace, schema } from "../db/index.js";
import { legacyHumanRow } from "../db/personalApp.js";
import { createWorkspace } from "../db/workspace.js";

export type SpaceServiceErrorCode =
  | "HUMAN_NOT_INITIALIZED"
  | "SPACE_NOT_FOUND"
  | "SPACE_NAME_INVALID"
  | "SPACE_SLUG_CONFLICT";

export class SpaceServiceError extends Error {
  constructor(public readonly code: SpaceServiceErrorCode, message: string) {
    super(message);
    this.name = "SpaceServiceError";
  }
}

function normalizeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) {
    throw new SpaceServiceError("SPACE_NAME_INVALID", "Space name must be between 1 and 80 characters");
  }
  return name;
}

function slugBase(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "space";
}

function availableSlug(value: unknown): string {
  const base = slugBase(value);
  let slug = base;
  for (let suffix = 2; ; suffix++) {
    const existing = getSpaceRecordBySlug(slug);
    if (!existing) return slug;
    slug = `${base}-${suffix}`;
  }
}

export function listLocalSpaces(): SpaceRecord[] {
  return listSpaceRecords();
}

export function getLocalSpace(spaceId: string): SpaceRecord {
  const space = getSpaceRecord(spaceId);
  if (!space) throw new SpaceServiceError("SPACE_NOT_FOUND", `Space not found: ${spaceId}`);
  return space;
}

export async function createLocalSpace(input: {
  name: unknown;
  slug?: unknown;
  rootPath?: string;
}): Promise<SpaceRecord> {
  const human = getHumanProfile();
  if (!human) throw new SpaceServiceError("HUMAN_NOT_INITIALIZED", "Human profile is not initialized");
  const name = normalizeName(input.name);
  const slug = availableSlug(input.slug ?? name);
  const created = await createWorkspace(name, slug, human.id, {
    rootPath: input.rootPath,
    owner: legacyHumanRow(human),
  });
  return getLocalSpace(created.id);
}

export async function updateLocalSpace(
  spaceId: string,
  input: { name?: unknown; slug?: unknown },
): Promise<SpaceRecord> {
  const current = getLocalSpace(spaceId);
  const name = input.name === undefined ? current.name : normalizeName(input.name);
  const slug = input.slug === undefined ? current.slug : slugBase(input.slug);
  const slugOwner = getSpaceRecordBySlug(slug);
  if (slugOwner && slugOwner.id !== current.id) {
    throw new SpaceServiceError("SPACE_SLUG_CONFLICT", `Space slug already exists: ${slug}`);
  }

  // workspace.db keeps this compatibility projection until the destructive A2 schema reset.
  const db = dbForSpace(spaceId);
  const updated = persistSpaceRecord({ ...current, name, slug, lastOpenedAt: new Date() });
  try {
    await db.update(schema.servers).set({ name, slug }).where(eq(schema.servers.id, spaceId));
    return updated;
  } catch (error) {
    try {
      persistSpaceRecord(current);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Space update and app.db rollback both failed");
    }
    throw error;
  }
}

export async function localSpaceUnreadSummary(): Promise<Array<{ spaceId: string; unreadCount: number }>> {
  const human = getHumanProfile();
  if (!human) throw new SpaceServiceError("HUMAN_NOT_INITIALIZED", "Human profile is not initialized");
  const summary: Array<{ spaceId: string; unreadCount: number }> = [];

  for (const space of listSpaceRecords()) {
    const db = dbForSpace(space.id);
    let unreadCount = 0;
    const memberships = await db.select().from(schema.channelMembers).where(and(
      eq(schema.channelMembers.memberType, "user"),
      eq(schema.channelMembers.memberId, human.id),
    ));
    if (memberships.length) {
      const channels = await db.select({
        id: schema.channels.id,
        type: schema.channels.type,
        deletedAt: schema.channels.deletedAt,
      }).from(schema.channels).where(inArray(schema.channels.id, memberships.map((membership) => membership.channelId)));
      const channelById = new Map(channels.filter((channel) => !channel.deletedAt).map((channel) => [channel.id, channel]));
      for (const membership of memberships) {
        const channel = channelById.get(membership.channelId);
        if (!channel || (channel.type === "thread" && membership.threadDoneAt)) continue;
        const [row] = await db.select({ total: count() }).from(schema.messages).where(and(
          eq(schema.messages.channelId, membership.channelId),
          gt(schema.messages.seq, membership.lastReadSeq),
          or(isNull(schema.messages.senderId), ne(schema.messages.senderId, human.id)),
        ));
        unreadCount += Number(row?.total ?? 0);
      }
    }
    summary.push({ spaceId: space.id, unreadCount });
  }
  return summary;
}
