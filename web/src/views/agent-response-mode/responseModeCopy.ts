import type { AgentResponseMode } from "./responseModeModel.ts";

export interface ResponseModeCopy {
  labelKey: string;
  shortLabelKey: string;
  descriptionKey: string;
}

export const RESPONSE_MODE_COPY: Record<AgentResponseMode, ResponseModeCopy> = {
  active: {
    labelKey: "responseMode.active",
    shortLabelKey: "responseMode.activeShort",
    descriptionKey: "responseMode.activeDescription",
  },
  mention_only: {
    labelKey: "responseMode.mentionOnly",
    shortLabelKey: "responseMode.mentionOnlyShort",
    descriptionKey: "responseMode.mentionOnlyDescription",
  },
  silent: {
    labelKey: "responseMode.silent",
    shortLabelKey: "responseMode.silentShort",
    descriptionKey: "responseMode.silentDescription",
  },
};
