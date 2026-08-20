import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAllSkillKeys, getSkillMetadata, listSkills } from "./skillRegistry.js";
import { loadSkill, skillFilePath } from "./skillLoader.js";

const FOUNDATION_KEYS = ["design_brief", "composition", "color", "typography", "anti_ai_slop", "polish"];
const DOMAIN_KEYS = ["poster_craft", "landing_page", "banner_ad"];

test("skill registry lists 6 foundation and 3 domain skills", () => {
  const catalog = listSkills();
  assert.equal(catalog.foundation.length, 6);
  assert.equal(catalog.domains.length, 3);
  assert.deepEqual(catalog.foundation.map((skill) => skill.skillKey).sort(), [...FOUNDATION_KEYS].sort());
  assert.deepEqual(catalog.domains.map((skill) => skill.skillKey).sort(), [...DOMAIN_KEYS].sort());
  assert.equal(getAllSkillKeys().length, 9);
  assert.equal(getSkillMetadata("poster_craft")?.priority, "P0");
  assert.equal(getSkillMetadata("poster_craft")?.category, "domains");
  assert.ok(getSkillMetadata("poster_craft")?.relatedSkills?.includes("design_brief"));
  assert.equal(getSkillMetadata("missing"), undefined);
});

test("skill loader returns markdown playbooks for every registered skill", () => {
  for (const skillKey of getAllSkillKeys()) {
    const skill = loadSkill(skillKey);
    assert.ok(skill, `skill ${skillKey} should load`);
    assert.match(skill.content, /^# /);
    assert.match(skill.content, /## When to use/);
    assert.match(skill.content, /## Hard rules/);
    assert.match(skill.content, /## Done when/);
    const onDisk = readFileSync(skillFilePath(skill.metadata), "utf8");
    assert.equal(skill.content, onDisk);
  }
  const brief = loadSkill("design_brief");
  assert.match(brief!.content, /visual_thesis/);
  assert.match(brief!.content, /设计简报/);
  const slop = loadSkill("anti_ai_slop");
  assert.match(slop!.content, /purple-blue gradient/i);
  assert.match(slop!.content, /glassmorphism/i);
  const poster = loadSkill("poster_craft");
  assert.match(poster!.content, /create_frame/);
  assert.match(poster!.content, /Halloween|hero/i);
  assert.match(poster!.content, /Visual thesis examples/);
  assert.match(poster!.content, /Icon construction examples/);
  assert.match(poster!.content, /boolean_op mode=subtract/);
  assert.equal(loadSkill("not_a_skill"), null);
});
