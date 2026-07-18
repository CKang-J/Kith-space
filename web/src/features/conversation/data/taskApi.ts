import { useMemo, useRef } from "react";
import { useStore } from "../../../store.tsx";
import type { ConversationApiClient } from "./conversationApi.ts";

export interface TaskLocation {
  id: string;
  channelId: string;
  taskNumber: number;
}

export interface TaskApi {
  updateMessageTask(messageId: string, action: string, body?: unknown): Promise<void>;
  findTaskByNumber(taskNumber: number): Promise<TaskLocation | undefined>;
  convertMessage(messageId: string): Promise<void>;
}

export function createTaskApi(api: ConversationApiClient): TaskApi {
  return {
    async updateMessageTask(messageId, action, body) {
      await api("PATCH", `/api/tasks/${encodeURIComponent(messageId)}/${encodeURIComponent(action)}`, body);
    },
    async findTaskByNumber(taskNumber) {
      const result = await api("GET", "/api/tasks/space");
      const tasks = Array.isArray(result?.tasks) ? result.tasks : Array.isArray(result) ? result : [];
      return tasks.find((task: TaskLocation) => task.taskNumber === taskNumber);
    },
    async convertMessage(messageId) {
      await api("POST", "/api/tasks/convert-message", { messageId });
    },
  };
}

export function useTaskApi(): TaskApi {
  const { api } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  return useMemo(() => createTaskApi((method, path, body) => apiRef.current(method, path, body)), []);
}
