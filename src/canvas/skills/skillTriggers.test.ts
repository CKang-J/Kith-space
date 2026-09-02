import assert from "node:assert/strict";
import test from "node:test";
import { listSkills } from "./skillRegistry.js";
import { matchedSkillKeys, positivelyPresent, triggerMatches } from "./skillTriggers.js";

const ALL = [...listSkills().foundation, ...listSkills().domains];

test("positivelyPresent matches outside a negation window", () => {
  assert.equal(positivelyPresent("give me a poster", "poster"), true);
  assert.equal(positivelyPresent("POSTER please", "poster"), true);
  assert.equal(positivelyPresent("不要做成海报风", "海报"), false);
  assert.equal(positivelyPresent("not a poster", "poster"), false);
  assert.equal(positivelyPresent("no other text", "poster"), false);
});

test("triggerMatches honors promptIncludesAny and negatePromptIncludesAny", () => {
  assert.equal(triggerMatches({ promptIncludesAny: ["海报", "poster"] }, "帮我做一张海报"), true);
  assert.equal(triggerMatches({ promptIncludesAny: ["海报", "poster"] }, "不要海报"), false);
  assert.equal(triggerMatches({ promptIncludesAny: ["poster"], negatePromptIncludesAny: ["landing"] }, "poster landing"), false);
  assert.equal(triggerMatches(undefined, "poster"), false);
  assert.equal(triggerMatches({ promptIncludesAny: [] }, "poster"), false);
});

test("matchedSkillKeys hits keywords, honors negation window and case", () => {
  assert.ok(matchedSkillKeys("给我画一张海报", ALL).includes("poster_craft"));
  assert.ok(matchedSkillKeys("做一个 landing page 落地页", ALL).includes("landing_page"));
  assert.ok(matchedSkillKeys("设计一个 DASHBOARD 后台看板", ALL).includes("dashboard_ui"));

  const negated = matchedSkillKeys("不要做成海报风", ALL);
  assert.ok(!negated.includes("poster_craft"));

  const mixed = matchedSkillKeys("not a poster, just a banner", ALL);
  assert.ok(mixed.includes("banner_ad"));
  assert.ok(!mixed.includes("poster_craft"));
});

test("matchedSkillKeys returns nothing when no keyword or no prompt", () => {
  assert.deepEqual(matchedSkillKeys("把文字放大一点", ALL), []);
  assert.deepEqual(matchedSkillKeys("", ALL), []);
  assert.deepEqual(matchedSkillKeys(null, ALL), []);
});
