import { eq } from "drizzle-orm";
import { assertChannelWritable } from "../../channels/channelLifecycle.js";
import { dbForSpace, schema } from "../../db/index.js";
import { deleteObject, readObject } from "../../files/localObjectStorage.js";
import { parseUpload } from "../attachments.js";
import { canAgentReadChannel, resolveIdOrPrefix, resolveTarget } from "../core.js";
import { sendErr, sendJson } from "../util.js";
import type { AgentHttpContext } from "./context.js";

export async function handleFilesModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, url, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  if (path === "/agent-api/attachment/upload" && method === "POST") {
    const { fields, files } = await parseUpload(spaceId, req);
    let target: Awaited<ReturnType<typeof resolveTarget>>;
    try {
      target = await resolveTarget(spaceId, fields.channel ?? fields.target ?? "", agent.id);
      if (target?.channelId) await assertChannelWritable(spaceId, target.channelId);
    } catch (error) {
      await Promise.allSettled(files.map((file) => deleteObject(spaceId, file.storageKey)));
      throw error;
    }
    const attachments = [];
    for (const file of files) {
      const attachment = db.insert(schema.attachments).values({
        spaceId,
        channelId: target?.channelId ?? null,
        uploaderType: "agent",
        uploaderId: agent.id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        storageKey: file.storageKey,
      }).returning().get();
      attachments.push({
        attachmentId: attachment.id,
        id: attachment.id,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes,
      });
    }
    sendJson(res, 200, { attachments, attachmentId: attachments[0]?.attachmentId });
    return true;
  }

  if (path === "/agent-api/attachment/view" && method === "GET") {
    const rawId = (url.searchParams.get("id") || "").trim();
    if (!rawId) return (sendErr(res, 400, "id required"), true);
    const attachmentId = await resolveIdOrPrefix(schema.attachments, spaceId, rawId);
    const attachment = attachmentId
      ? db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId)).get()
      : undefined;
    if (!attachment) return (sendErr(res, 404, "attachment not found"), true);
    const canView = (attachment.uploaderType === "agent" && attachment.uploaderId === agent.id)
      || Boolean(attachment.channelId && await canAgentReadChannel(spaceId, attachment.channelId, agent.id));
    if (!canView) return (sendErr(res, 404, "attachment not found"), true);
    try {
      const buffer = await readObject(spaceId, attachment.storageKey);
      const tooBig = 12 * 1024 * 1024;
      const isText = !buffer.includes(0)
        && ((attachment.mimeType ?? "").startsWith("text") || buffer.length < 65_536);
      const body: Record<string, unknown> = {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
      if (isText) body.text = buffer.toString("utf8").slice(0, 100_000);
      if (buffer.length <= tooBig) body.base64 = buffer.toString("base64");
      else body.note = `file too large to inline (${attachment.sizeBytes}B); on server storageKey=${attachment.storageKey}`;
      sendJson(res, 200, body);
      return true;
    } catch (error) {
      sendErr(res, 500, `read failed: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  return false;
}
