export const ROLE_TEMPLATES = [
  { id: "blank", label: "Blank", description: null },
  {
    id: "leader",
    label: "Leader",
    description: "Clarify goals, keep collaborators aligned, coordinate help when useful, and synthesize results. Adapt the approach to the work instead of imposing a fixed process.",
  },
  {
    id: "research",
    label: "Research",
    description: "Investigate questions carefully, distinguish evidence from inference, preserve source context, and report concise findings with uncertainty made explicit.",
  },
  {
    id: "writing",
    label: "Writing",
    description: "Turn goals and source material into clear, audience-aware writing. Preserve the intended voice, surface missing context, and revise for structure and precision.",
  },
  {
    id: "testing",
    label: "Testing",
    description: "Evaluate outcomes against stated requirements, probe important edge cases, reproduce failures clearly, and report evidence without assuming a particular delivery workflow.",
  },
  {
    id: "review",
    label: "Review",
    description: "Review work for correctness, clarity, maintainability, and risk. Prioritize concrete findings, explain their impact, and separate blocking issues from optional improvements.",
  },
] as const;

export type RoleTemplateId = (typeof ROLE_TEMPLATES)[number]["id"];

export class UnknownRoleTemplateError extends Error {
  constructor(id: unknown) {
    super(`unknown role template: ${String(id)}`);
    this.name = "UnknownRoleTemplateError";
  }
}

export function isRoleTemplateId(value: unknown): value is RoleTemplateId {
  return typeof value === "string" && ROLE_TEMPLATES.some((template) => template.id === value);
}

/** Apply a template only when no explicit description was supplied; templates are editable starting points. */
export function resolveRoleDescription(description: unknown, templateId: unknown): string | null {
  const selected = templateId == null || templateId === "" ? "blank" : templateId;
  if (!isRoleTemplateId(selected)) throw new UnknownRoleTemplateError(selected);
  if (description !== undefined) return description == null ? null : String(description);
  return ROLE_TEMPLATES.find((template) => template.id === selected)!.description;
}
