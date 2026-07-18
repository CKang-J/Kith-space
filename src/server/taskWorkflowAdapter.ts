import { configureTaskWorkflowEvents } from "../tasks/taskService.js";
import { publish } from "./realtime.js";

configureTaskWorkflowEvents({ publish });

export { getTaskDetails, reportTask, submitTaskDelivery } from "../tasks/taskService.js";
