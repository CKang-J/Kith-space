import { createThreadModule } from "../channels/threadModule.js";
import { publish } from "./realtime.js";

export const threadModule = createThreadModule({ publish });
