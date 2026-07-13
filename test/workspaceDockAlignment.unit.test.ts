import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/shell/shell.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("inactive Dock icons stay centered while the active item reveals its label", () => {
  assert.match(ruleBody(".workspace-dock__item"), /gap\s*:\s*0(?:;|$)/);
  assert.match(
    ruleBody(".workspace-dock__item.is-active:not(.workspace-dock__chat)"),
    /gap\s*:\s*8px(?:;|$)/,
  );
});
