import { resolveRoleDescription } from "../../agents/roleTemplates.js";
import { createMessage, resolveTarget } from "../core.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { AgentHttpContext } from "./context.js";

export async function handleActionsModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, method, path, agent, spaceId } = context;
  if (!(path === "/agent-api/action/prepare" && method === "POST")) return false;

  const body = await readJson(req);
  const action = body.action;
  if (!action || typeof action !== "object") {
    return (sendErr(res, 400, "action (object) required on stdin", { code: "BAD_ACTION" }), true);
  }
  if (Object.prototype.hasOwnProperty.call(action, "initialHumans")) {
    return (sendErr(res, 400, "initialHumans is not supported", { code: "BAD_ACTION" }), true);
  }
  const type = String(action.type ?? "");
  if (type !== "channel:create" && type !== "agent:create") {
    return (sendErr(res, 400, `unsupported action.type "${type}" (only channel:create / agent:create)`, { code: "BAD_ACTION" }), true);
  }
  if (!String(action.name ?? "").trim()) {
    return (sendErr(res, 400, "action.name required", { code: "BAD_ACTION" }), true);
  }
  const target = await resolveTarget(spaceId, String(body.target ?? ""), agent.id);
  if (!target) return (sendErr(res, 404, "target not found", { code: "TARGET_FAILED" }), true);

  let normalized;
  if (type === "channel:create") {
    normalized = {
      type,
      name: String(action.name).trim().replace(/^#/, ""),
      description: action.description ?? null,
      visibility: action.visibility === "private" ? "private" : "public",
      initialAgents: Array.isArray(action.initialAgents) ? action.initialAgents : [],
    } as const;
  } else {
    let description: string | null;
    try {
      description = resolveRoleDescription(action.description, action.roleTemplate);
    } catch (error) {
      return (sendErr(res, 400, (error as Error).message, { code: "BAD_ACTION" }), true);
    }
    normalized = {
      type,
      name: String(action.name).trim().replace(/^@/, ""),
      description,
      roleTemplate: action.roleTemplate ?? "blank",
    } as const;
  }
  const message = await createMessage({
    spaceId,
    channelId: target.channelId,
    senderType: "agent",
    senderId: agent.id,
    senderName: agent.name,
    content: "",
    messageType: "action",
    threadId: target.threadId,
    actionMetadata: {
      kind: "action-card",
      state: "prepared",
      action: normalized,
      executedAt: null,
      executedByUserId: null,
      executedByUserName: null,
      result: null,
    },
  });
  sendJson(res, 200, {
    ok: true,
    id: message.id,
    seq: message.seq,
    target: body.target,
    action: normalized,
  });
  return true;
}
