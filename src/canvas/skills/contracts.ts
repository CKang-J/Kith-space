export type SkillCategory = "foundation" | "domains";
export type SkillPriority = "P0" | "P1" | "P2";

export interface SkillMetadata {
  skillKey: string;
  displayName: string;
  category: SkillCategory;
  whenToUse: string;
  description: string;
  relatedSkills?: string[];
  priority: SkillPriority;
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
