import { and, eq, isNull } from "drizzle-orm";
import { dbFor, schema } from "../db/index.js";
import { stopAgent } from "./core.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

export async function taskDispatchStatus(serverId: string, taskMessageId: string) {
  return new SqliteDispatchState(serverId).taskStatus(taskMessageId);
}

export async function stopTaskDispatch(serverId: string, taskMessageId: string, reason?: string) {
  const state = new SqliteDispatchState(serverId);
  await state.stopTask(taskMessageId, reason);
  const agentIds = await state.agentsForTask(taskMessageId);
  await Promise.all(agentIds.map((agentId) => stopAgent(serverId, agentId)));
  return { ...(await state.taskStatus(taskMessageId)), stoppedAgentIds: agentIds };
}

export async function resumeTaskDispatch(serverId: string, taskMessageId: string) {
  const state = new SqliteDispatchState(serverId);
  await state.resumeTask(taskMessageId);
  return state.taskStatus(taskMessageId);
}

export async function spaceDispatchStatus(serverId: string) {
  return new SqliteDispatchState(serverId).spaceStatus();
}

export async function stopSpaceDispatch(serverId: string, reason?: string) {
  const state = new SqliteDispatchState(serverId);
  await state.stopSpace(reason);
  const db = dbFor(serverId);
  const agents = db.select({ id: schema.agents.id }).from(schema.agents).where(andServerLive(serverId)).all();
  const agentIds = agents.map((agent) => agent.id);
  await Promise.all(agentIds.map((agentId) => stopAgent(serverId, agentId)));
  return { ...(await state.spaceStatus()), stoppedAgentIds: agentIds };
}

export async function resumeSpaceDispatch(serverId: string) {
  const state = new SqliteDispatchState(serverId);
  await state.resumeSpace();
  return state.spaceStatus();
}

const andServerLive = (serverId: string) => {
  // Kept local so the control module owns the exact meaning of "all agents in the space".
  return and(eq(schema.agents.serverId, serverId), isNull(schema.agents.deletedAt));
};
