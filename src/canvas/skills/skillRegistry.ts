import type { SkillCatalog, SkillMetadata } from "./contracts.js";

const SKILL_REGISTRY: Record<string, SkillMetadata> = {
  design_brief: {
    skillKey: "design_brief",
    displayName: "Design Brief",
    category: "foundation",
    whenToUse: "Starting any new design from scratch",
    description: "Structured design brief template covering purpose, audience, emotion, visual thesis, and composition archetype",
    priority: "P0",
  },
  composition: {
    skillKey: "composition",
    displayName: "Composition",
    category: "foundation",
    whenToUse: "Making layout and composition decisions",
    description: "Layout archetypes (hero, split, grid, etc.) and composition rules (balance, focal point, rhythm)",
    priority: "P0",
  },
  color: {
    skillKey: "color",
    displayName: "Color",
    category: "foundation",
    whenToUse: "Choosing color palette or making color decisions",
    description: "Color theory, palette strategies (monochrome, analogous, complementary, triadic), and emotional associations",
    priority: "P0",
  },
  typography: {
    skillKey: "typography",
    displayName: "Typography",
    category: "foundation",
    whenToUse: "Choosing fonts or setting type hierarchy",
    description: "Type ladders (hero/title/body/caption), font pairing rules, and hierarchy principles",
    priority: "P0",
  },
  anti_ai_slop: {
    skillKey: "anti_ai_slop",
    displayName: "Anti-AI Slop",
    category: "foundation",
    whenToUse: "Always (implicit check before finalizing)",
    description: "Common AI design clichés to avoid: purple-blue gradients, glassmorphism, isometric function cards, random particles, etc.",
    priority: "P0",
  },
  polish: {
    skillKey: "polish",
    displayName: "Polish",
    category: "foundation",
    whenToUse: "Final refinement before completion",
    description: "Refinement checklist and self-review criteria",
    relatedSkills: ["anti_ai_slop", "composition", "typography"],
    priority: "P1",
  },
  poster_craft: {
    skillKey: "poster_craft",
    displayName: "Poster Craft",
    category: "domains",
    whenToUse: "Creating posters, roll-ups, or key visuals",
    description: "End-to-end poster design playbook: brief → art direction → layout → execution → review",
    relatedSkills: ["design_brief", "composition", "color", "typography", "anti_ai_slop"],
    priority: "P0",
  },
  landing_page: {
    skillKey: "landing_page",
    displayName: "Landing Page",
    category: "domains",
    whenToUse: "Designing landing pages or homepage hero sections",
    description: "Landing page design playbook: hero section, value props, social proof, CTA hierarchy",
    relatedSkills: ["design_brief", "composition", "typography"],
    priority: "P1",
  },
  banner_ad: {
    skillKey: "banner_ad",
    displayName: "Banner Ad",
    category: "domains",
    whenToUse: "Creating banner ads or social media ads",
    description: "Banner ad design playbook: attention-grabbing within size constraints, clear CTA",
    relatedSkills: ["design_brief", "color", "typography"],
    priority: "P1",
  },
};

export function getSkillMetadata(skillKey: string): SkillMetadata | undefined {
  return SKILL_REGISTRY[skillKey];
}

export function listSkills(): SkillCatalog {
  const all = Object.values(SKILL_REGISTRY);
  return {
    foundation: all.filter((skill) => skill.category === "foundation"),
    domains: all.filter((skill) => skill.category === "domains"),
  };
}

export function getAllSkillKeys(): string[] {
  return Object.keys(SKILL_REGISTRY);
}
