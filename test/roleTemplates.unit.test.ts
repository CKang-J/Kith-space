import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_TEMPLATES, UnknownRoleTemplateError, resolveRoleDescription } from "../src/agents/roleTemplates.ts";

test("role templates provide blank, leader, research, writing, testing, and review starting points", () => {
  assert.deepEqual(ROLE_TEMPLATES.map((template) => template.id), ["blank", "leader", "research", "writing", "testing", "review"]);
  assert.equal(resolveRoleDescription(undefined, undefined), null);
  assert.equal(resolveRoleDescription(undefined, "blank"), null);
  assert.match(resolveRoleDescription(undefined, "research") ?? "", /evidence from inference/);
});

test("an explicit responsibility overrides the selected starting template", () => {
  assert.equal(resolveRoleDescription("Custom responsibility", "leader"), "Custom responsibility");
  assert.equal(resolveRoleDescription("", "testing"), "");
});

test("unknown role template ids are rejected", () => {
  assert.throws(() => resolveRoleDescription(undefined, "developer-pipeline"), UnknownRoleTemplateError);
});
