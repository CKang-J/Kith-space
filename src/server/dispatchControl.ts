import { and, eq, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";
import { stopAgent } from "./core.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

export async function taskDispatchStatus(spaceId: string, taskMessageId: string) {
  return new SqliteDispatchState(spaceId).taskStatus(taskMessageId);
}

export async function stopTaskDispatch(spaceId: string, taskMessageId: string, reason?: string) {
  const state = new SqliteDispatchState(spaceId);
  await state.stopTask(taskMessageId, reason);
  const agentIds = await state.agentsForTask(taskMessageId);
  await Promise.all(agentIds.map((agentId) => stopAgent(spaceId, agentId)));
  return { ...(await state.taskStatus(taskMessageId)), stoppedAgentIds: agentIds };
}

export async function resumeTaskDispatch(spaceId: string, taskMessageId: string) {
  const state = new SqliteDispatchState(spaceId);
  await state.resumeTask(taskMessageId);
  return state.taskStatus(taskMessageId);
}

export async function spaceDispatchStatus(spaceId: string) {
  return new SqliteDispatchState(spaceId).spaceStatus();
}

export async function stopSpaceDispatch(spaceId: string, reason?: string) {
  const state = new SqliteDispatchState(spaceId);
  await state.stopSpace(reason);
  const db = dbForSpace(spaceId);
  const agents = db.select({ id: schema.agents.id }).from(schema.agents).where(andSpaceLive(spaceId)).all();
  const agentIds = agents.map((agent) => agent.id);
  await Promise.all(agentIds.map((agentId) => stopAgent(spaceId, agentId)));
  return { ...(await state.spaceStatus()), stoppedAgentIds: agentIds };
}

export async function resumeSpaceDispatch(spaceId: string) {
  const state = new SqliteDispatchState(spaceId);
  await state.resumeSpace();
  return state.spaceStatus();
}

const andSpaceLive = (spaceId: string) => {
  // Kept local so the control module owns the exact meaning of "all agents in the space".
  return and(eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt));
};
