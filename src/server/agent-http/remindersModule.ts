import { and, asc, eq } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { findParentMessage, type AgentHttpContext } from "./context.js";

export async function handleRemindersModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  if (path === "/agent-api/reminder/schedule" && method === "POST") {
    const body = await readJson(req);
    if (!body.content) return (sendErr(res, 400, "content required"), true);
    let remindAt: Date;
    if (body.at) {
      remindAt = new Date(body.at);
      if (Number.isNaN(remindAt.getTime())) return (sendErr(res, 400, "invalid --at iso time"), true);
    } else if (body.in != null && Number(body.in) > 0) {
      remindAt = new Date(Date.now() + Number(body.in) * 1_000);
    } else {
      return (sendErr(res, 400, "provide --in <seconds> or --at <iso>"), true);
    }
    const anchor = body.anchor
      ? await findParentMessage(context, String(body.anchor), null)
      : null;
    const reminder = db.insert(schema.reminders).values({
      spaceId,
      ownerType: "agent",
      ownerId: agent.id,
      content: String(body.content),
      remindAt,
      anchorMessageId: anchor?.id ?? null,
      recurrence: body.recurring && Number(body.recurring) > 0
        ? String(Number(body.recurring))
        : null,
    }).returning().get();
    sendJson(res, 200, { ok: true, id: reminder.id, remindAt: reminder.remindAt });
    return true;
  }

  if (path === "/agent-api/reminder/list" && method === "GET") {
    const reminders = db.select().from(schema.reminders).where(and(
      eq(schema.reminders.spaceId, spaceId),
      eq(schema.reminders.ownerType, "agent"),
      eq(schema.reminders.ownerId, agent.id),
    )).orderBy(asc(schema.reminders.remindAt)).all();
    sendJson(res, 200, {
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        content: reminder.content,
        remindAt: reminder.remindAt,
        status: reminder.status,
        recurrence: reminder.recurrence,
      })),
    });
    return true;
  }

  if (path === "/agent-api/reminder/cancel" && method === "POST") {
    const body = await readJson(req);
    if (!body.id) return (sendErr(res, 400, "id required"), true);
    db.update(schema.reminders).set({ status: "cancelled" }).where(and(
      eq(schema.reminders.id, String(body.id)),
      eq(schema.reminders.ownerId, agent.id),
    )).run();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/agent-api/reminder/snooze" && method === "POST") {
    const body = await readJson(req);
    if (!body.id || body.in == null) return (sendErr(res, 400, "id + in(seconds) required"), true);
    db.update(schema.reminders).set({
      remindAt: new Date(Date.now() + Number(body.in) * 1_000),
      status: "scheduled",
      firedAt: null,
    }).where(and(
      eq(schema.reminders.id, String(body.id)),
      eq(schema.reminders.ownerId, agent.id),
    )).run();
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
