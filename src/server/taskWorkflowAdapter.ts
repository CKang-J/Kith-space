import { configureTaskWorkflowEvents } from "../tasks/taskService.js";
import { publish } from "./realtime.js";
import { scheduleV2Turns } from "./harnessComposition.js";

configureTaskWorkflowEvents({
  async publish(spaceId, event) {
    await publish(spaceId, event);
    if ((event as { type?: unknown } | null)?.type === "message") await scheduleV2Turns(spaceId);
  },
});

export { getTaskDetails, reportTask, submitTaskDelivery } from "../tasks/taskService.js";
