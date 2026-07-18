// Agent-side REST transport index. Authentication, scope checks, and endpoint dispatch live here;
// business/database work is owned by the seven bounded modules under ./agent-http/.
import type { IncomingMessage, ServerResponse } from "node:http";
import { agentHasScope } from "../agents/agentScopes.js";
import { handleActionsModule } from "./agent-http/actionsModule.js";
import { handleChannelsThreadsModule } from "./agent-http/channelsThreadsModule.js";
import type { AgentHttpContext } from "./agent-http/context.js";
import { handleFilesModule } from "./agent-http/filesModule.js";
import { handleMessagesContextModule } from "./agent-http/messagesContextModule.js";
import { handleProfileSpaceModule } from "./agent-http/profileSpaceModule.js";
import { handleRemindersModule } from "./agent-http/remindersModule.js";
import { handleTasksModule } from "./agent-http/tasksModule.js";
import { resolveAgent } from "./auth.js";
import { agentIdHeader, bearer, sendErr } from "./util.js";

export { addressableTarget, formatAgentMessage as fmt } from "./agent-http/context.js";

const moduleHandlers = [
  handleMessagesContextModule,
  handleChannelsThreadsModule,
  handleTasksModule,
  handleActionsModule,
  handleFilesModule,
  handleProfileSpaceModule,
  handleRemindersModule,
] as const;

function requiredScope(path: string): string | null {
  if (path === "/agent-api/message/check") return "inbox:receive";
  if (path === "/agent-api/message/send") return "message:send";
  if (path === "/agent-api/message/read") return "message:read";
  if (path === "/agent-api/message/react") return "message:send";
  if (path === "/agent-api/space/info") return "space:read";
  if (path === "/agent-api/channel/join") return "channel:join";
  if (path === "/agent-api/task/list" || path === "/agent-api/task/get") return "task:read";
  if ([
    "/agent-api/task/claim",
    "/agent-api/task/update",
    "/agent-api/task/new",
    "/agent-api/task/assign",
    "/agent-api/task/report",
    "/agent-api/task/delivery",
    "/agent-api/task/unclaim",
  ].includes(path)) return "task:write";
  if (path === "/agent-api/search") return "message:read";
  if (path === "/agent-api/attachment/upload") return "attachment:upload";
  if (path === "/agent-api/thread/reply") return "message:send";
  if (path === "/agent-api/thread/read") return "message:read";
  if (path === "/agent-api/message/resolve") return "message:read";
  if (path === "/agent-api/channel/members") return "channel:read";
  if (path === "/agent-api/channel/leave") return "channel:leave";
  if (path === "/agent-api/thread/unfollow") return "thread:unfollow";
  if (path === "/agent-api/attachment/view") return "attachment:view";
  if (path === "/agent-api/profile/show") return "space:read";
  if (path === "/agent-api/action/prepare") return "action:prepare";
  return null;
}

export async function handleAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/agent-api/")) return false;

  const agent = await resolveAgent(bearer(req), agentIdHeader(req));
  if (!agent) {
    sendErr(res, 401, "unauthorized (need Bearer sk_agent_* token + x-agent-id header)");
    return true;
  }
  const scope = requiredScope(path);
  if (scope && !agentHasScope(agent.scopes, scope)) {
    sendErr(res, 403, `missing scope: ${scope}`, { code: "SCOPE_DENIED", scope });
    return true;
  }

  const context: AgentHttpContext = {
    req,
    res,
    url,
    method,
    path,
    agent,
    spaceId: agent.spaceId,
  };
  for (const handler of moduleHandlers) {
    if (await handler(context)) return true;
  }
  sendErr(res, 404, "not found");
  return true;
}
