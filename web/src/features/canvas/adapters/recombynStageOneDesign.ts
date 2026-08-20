import { StageOneCapabilityUnavailable } from "./recombynStageOneServices";

export type DesignRunMode = "agent" | "single_model" | "partial";
export type DesignScene = "website" | "mobile" | "image" | "poster" | "drawing" | "video";
export type DesignCatalog = Record<string, unknown>;
export type DesignJobEvent = Record<string, unknown>;
export type DesignSvgPatch = Record<string, unknown>;
export type RunDesignJobBody = Record<string, unknown>;

const unavailable = (capability: string): Promise<never> =>
  Promise.reject(new StageOneCapabilityUnavailable(capability));

export async function fetchDesignCatalog(): Promise<DesignCatalog> {
  return {};
}

export const generateLottie = () => unavailable("generateLottie");
export const runDesignJob = () => unavailable("runDesignJob");
export const resumeDesignJob = () => unavailable("resumeDesignJob");
export const fetchDesignRunStatus = () => unavailable("fetchDesignRunStatus");
export const postDesignSceneFeedback = () => unavailable("postDesignSceneFeedback");
export const parseDesignJobEvent = (): null => null;
