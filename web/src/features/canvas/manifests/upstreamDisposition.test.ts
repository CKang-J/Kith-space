import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RECOMBYN_PROMPT_DISPOSITION, RECOMBYN_SKILL_DISPOSITION, RECOMBYN_TOOLOPS_DISPOSITION } from "./upstreamDisposition.ts";

test("stage-one upstream disposition is exhaustive and unique", () => {
  assert.equal(RECOMBYN_PROMPT_DISPOSITION.length, 45);
  assert.equal(RECOMBYN_SKILL_DISPOSITION.length, 28);
  assert.equal(RECOMBYN_TOOLOPS_DISPOSITION.length, 24);
  for (const items of [RECOMBYN_PROMPT_DISPOSITION, RECOMBYN_SKILL_DISPOSITION, RECOMBYN_TOOLOPS_DISPOSITION]) {
    assert.equal(new Set(items.map((item) => item.key)).size, items.length);
    assert.ok(items.every((item) => item.source && item.license && Array.isArray(item.dependencies) && item.reason));
  }
  assert.deepEqual(
    RECOMBYN_SKILL_DISPOSITION.filter((item) => item.dependencies.length === 0).map((item) => item.key),
    ["design_brief", "design_review"],
  );
  assert.ok(RECOMBYN_SKILL_DISPOSITION.find((item) => item.key === "image_gen")?.dependencies.includes("skill:composition"));
  assert.ok(RECOMBYN_SKILL_DISPOSITION.find((item) => item.key === "banner_ad")?.dependencies.includes("skill:garden_style"));
  assert.ok(RECOMBYN_SKILL_DISPOSITION.find((item) => item.key === "ecommerce_surface")?.dependencies.includes("skill:shadcn_ui"));
  assert.ok(RECOMBYN_SKILL_DISPOSITION.find((item) => item.key === "type_specimen")?.dependencies.includes("skill:image_gen"));
  assert.ok(RECOMBYN_TOOLOPS_DISPOSITION.every((item) => item.dependencies.length > 0));
  assert.ok(RECOMBYN_TOOLOPS_DISPOSITION.find((item) => item.key === "outline_text")?.dependencies.includes("licensed local fonts"));
  assert.ok(RECOMBYN_TOOLOPS_DISPOSITION.find((item) => item.key === "create_svg")?.dependencies.includes("Kith SVG sanitizer"));
  assert.ok(RECOMBYN_TOOLOPS_DISPOSITION.find((item) => item.key === "image_process")?.dependencies.includes("durable image job"));
  assert.ok(RECOMBYN_TOOLOPS_DISPOSITION.find((item) => item.key === "export_canvas")?.dependencies.includes("Canvas export port"));

  const promptIndex = JSON.parse(readFileSync("reference/recombyn/apps/api/seeds/design_prompt_packs/_index.json", "utf8")) as {
    items: Array<{ kind: string; usedBy: string[] }>;
  };
  assert.deepEqual(
    RECOMBYN_PROMPT_DISPOSITION.map((item) => [item.key, item.usedBy]),
    promptIndex.items.map((item) => [item.kind, item.usedBy]),
  );

  const skillKeys = RECOMBYN_SKILL_DISPOSITION.map((item) => item.key);
  for (const item of RECOMBYN_SKILL_DISPOSITION) {
    const upstream = readFileSync(`reference/recombyn/${item.source}`, "utf8");
    const relatedStart = upstream.indexOf("\n## Related");
    const relatedTail = relatedStart < 0 ? "" : upstream.slice(relatedStart + 1);
    const nextHeading = relatedTail.indexOf("\n## ", 4);
    const relatedSection = nextHeading < 0 ? relatedTail : relatedTail.slice(0, nextHeading);
    const referenced = skillKeys.filter((key) => key !== item.key && new RegExp(`(?<![a-z0-9_])${key}(?![a-z0-9_])`).test(relatedSection));
    assert.deepEqual(item.related, referenced, `${item.key} skill references`);
  }
});
