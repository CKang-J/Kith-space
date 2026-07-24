import type { MemoryEvidenceInput } from "./contracts.js";

export type DisclosureProjection = "canonical" | "internal_summary" | "shareable_summary" | "ref_only";

/** Disclosure is evaluated against the output surface, independently from internal recall eligibility. */
export function disclosureProjection(input: {
  disclosure: "internal_use" | "shareable_summary" | "explicit_only";
  targetSurfaceId: string;
  evidence: Array<Pick<MemoryEvidenceInput, "sourceSurfaceId" | "visibilityAtOccurrence">>;
  hasInternalSummary: boolean;
  hasShareableSummary: boolean;
}): DisclosureProjection {
  if (input.evidence.length > 0 && input.evidence.every(
    (item) => item.visibilityAtOccurrence === "public" || item.sourceSurfaceId === input.targetSurfaceId,
  )) {
    return "canonical";
  }
  if (input.disclosure === "shareable_summary" && input.hasShareableSummary) return "shareable_summary";
  if (input.disclosure === "internal_use" && input.hasInternalSummary) return "internal_summary";
  return "ref_only";
}
