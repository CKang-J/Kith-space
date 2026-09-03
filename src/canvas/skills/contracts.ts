export type SkillCategory = "foundation" | "domains";
export type SkillPriority = "P0" | "P1" | "P2";

/** Server-side pre-filter keywords (from Recombyn `_meta.json` `triggers.prompt_includes_any`). */
export interface SkillTriggers {
  promptIncludesAny?: string[];
  negatePromptIncludesAny?: string[];
}

export interface SkillMetadata {
  skillKey: string;
  displayName: string;
  category: SkillCategory;
  whenToUse: string;
  description: string;
  relatedSkills?: string[];
  priority: SkillPriority;
  triggers?: SkillTriggers;
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
}

export interface SkillCatalog {
  foundation: SkillMetadata[];
  domains: SkillMetadata[];
}

export interface CanvasSkillListResult {
  catalog: SkillCatalog;
  nextSuggestedAction: string;
}

export interface CanvasSkillGetResult {
  skillKey: string;
  metadata: SkillMetadata;
  content: string;
  nextSuggestedAction: string;
}
