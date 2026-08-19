import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, SkillMetadata } from "./contracts.js";
import { getSkillMetadata } from "./skillRegistry.js";

const PACKAGED_SKILLS_ENV = "KITH_SPACE_CANVAS_SKILLS_DIR";

function moduleSkillsRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function resolveCanvasSkillsRoot(): string {
  const fromEnv = process.env[PACKAGED_SKILLS_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return moduleSkillsRoot();
}

export function skillFilePath(metadata: SkillMetadata, root = resolveCanvasSkillsRoot()): string {
  return join(root, metadata.category, `${metadata.skillKey}.md`);
}

export function loadSkill(skillKey: string): Skill | null {
  const metadata = getSkillMetadata(skillKey);
  if (!metadata) return null;
  const candidates = [
    skillFilePath(metadata),
    skillFilePath(metadata, moduleSkillsRoot()),
    skillFilePath(metadata, join(process.cwd(), "src", "canvas", "skills")),
  ];
  const seen = new Set<string>();
  for (const filePath of candidates) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    if (!content.trim()) continue;
    return { metadata, content };
  }
  return null;
}
