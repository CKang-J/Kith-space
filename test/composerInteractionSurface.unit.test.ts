import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composerTextNeedsExpansion } from "../web/src/views/composer/useComposerExpansion.ts";

const composer = fs.readFileSync(new URL("../web/src/views/Composer.tsx", import.meta.url), "utf8");
const actions = fs.readFileSync(new URL("../web/src/views/composer/ComposerActions.tsx", import.meta.url), "utf8");
const expansion = fs.readFileSync(new URL("../web/src/views/composer/useComposerExpansion.ts", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const en = JSON.parse(fs.readFileSync(new URL("../web/src/locales/en.json", import.meta.url), "utf8"));
const zh = JSON.parse(fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8"));

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("composer exposes one combined photo and file picker from the add menu", () => {
  assert.equal((composer.match(/<input type="file"/g) ?? []).length, 1);
  assert.doesNotMatch(composer, /imgRef|uploadImage|uploadFile|ImagePlus/);
  assert.match(actions, /aria-haspopup="menu"/);
  assert.match(actions, /t\("chat\.addPhotosAndFiles"\)/);
  assert.equal(zh.chat.addPhotosAndFiles, "添加照片和文件");
  assert.equal(en.chat.addPhotosAndFiles, "Add photos and files");
});

test("task assignment moves from the add menu into a removable hover chip", () => {
  assert.match(actions, /role="menuitemcheckbox"/);
  assert.match(actions, /t\("chat\.assignTask"\)/);
  assert.match(actions, /className="composer-task-chip"/);
  assert.match(actions, /onClick=\{\(\) => onTaskChange\(false\)\}/);
  assert.equal(zh.chat.assignTask, "指派任务");
  assert.equal(en.chat.assignTask, "Assign task");

  const taskChip = ruleBody(".composer-task-chip");
  assert.match(taskChip, /border-radius\s*:\s*9999px/);
  assert.match(ruleBody(".composer-box"), /--composer-input-font-size\s*:\s*14px/);
  assert.match(taskChip, /font-size\s*:\s*var\(--composer-input-font-size\)/);
  assert.match(ruleBody(".composer-input"), /font-size\s*:\s*var\(--composer-input-font-size\)/);
  assert.match(css, /@media \(max-width:700px\)[\s\S]*\.composer-box\{--composer-input-font-size:16px\}/);
  assert.match(actions, /<X className="composer-task-chip__remove-icon"/);
  assert.doesNotMatch(actions, />\s*[x×]\s*</i);
  assert.match(ruleBody(".composer-task-chip__remove-icon"), /display\s*:\s*none/);
  assert.match(ruleBody(".composer-task-chip__remove-icon"), /width\s*:\s*14px/);
  assert.match(ruleBody(".composer-task-chip__remove-icon"), /height\s*:\s*14px/);
  assert.match(css, /\.composer-task-chip:hover \.composer-task-chip__default-icon[^{}]*\{display:none\}/);
  assert.match(css, /\.composer-task-chip:hover \.composer-task-chip__remove-icon[^{}]*\{display:block\}/);
});

test("task assignment shares the compact row and only the remaining safe text width triggers expansion", () => {
  assert.equal(composerTextNeedsExpansion("", 0, 200), false);
  assert.equal(composerTextNeedsExpansion("short draft", 80, 200), false);
  assert.equal(composerTextNeedsExpansion("task draft", 150, 200), false);
  assert.equal(composerTextNeedsExpansion("task draft", 150, 140), true);
  assert.equal(composerTextNeedsExpansion("safe edge", 200, 200), true);
  assert.equal(composerTextNeedsExpansion("manual\nbreak", 40, 200), true);
  assert.match(composer, /const expanded = textNeedsExpansion \|\| pendingAtts\.length > 0;/);
  assert.doesNotMatch(composer, /const expanded =[^;]*\|\| asTask/);
  assert.match(composer, /expanded \? "is-expanded" : "is-compact"/);
  assert.match(expansion, /querySelector<HTMLElement>\("\.cb-left"\)/);
  assert.match(expansion, /querySelector<HTMLElement>\("\.cb-right"\)/);
  assert.match(ruleBody(".composer-box.is-compact"), /min-height\s*:\s*48px/);
  assert.match(ruleBody(".composer-box.is-compact"), /border-radius\s*:\s*9999px/);
  assert.match(ruleBody(".composer-box.is-compact"), /grid-template-columns\s*:\s*auto minmax\(0,1fr\) auto/);
  assert.match(ruleBody(".composer-box.is-compact .composer-bar"), /display\s*:\s*contents/);
  assert.match(ruleBody(".composer-box.is-expanded"), /min-height\s*:\s*94px/);
  assert.match(ruleBody(".composer-box.is-expanded"), /border-radius\s*:\s*20px 20px 24px 24px/);
  assert.match(ruleBody(".composer-box.is-expanded .composer-bar"), /margin\s*:\s*8px -4px -2px/);
});

test("composer add and send controls use the circular reference treatment", () => {
  assert.match(composer, /<ArrowUp size=\{17\}/);
  assert.doesNotMatch(composer, /<Send\b/);
  assert.match(ruleBody(".composer-add-trigger"), /width\s*:\s*32px/);
  assert.match(ruleBody(".composer-add-trigger"), /height\s*:\s*32px/);
  assert.match(ruleBody(".composer-add-trigger"), /border-radius\s*:\s*9999px/);
  assert.match(ruleBody(".composer-add-trigger svg"), /width\s*:\s*18px/);
  assert.match(ruleBody(".composer-add-trigger svg"), /stroke-width\s*:\s*2\.4/);
  assert.match(ruleBody(".composer-add-trigger:focus-visible"), /outline\s*:\s*none/);
  assert.match(ruleBody(".composer-add-trigger:focus-visible"), /background\s*:\s*var\(--surface-strong\)/);
  assert.match(ruleBody(".send-btn"), /width\s*:\s*32px/);
  assert.match(ruleBody(".send-btn"), /height\s*:\s*32px/);
  assert.match(ruleBody(".send-btn"), /border-radius\s*:\s*9999px/);
  assert.match(ruleBody(".send-btn svg"), /stroke-width\s*:\s*2\.2/);
});

test("add menu is portaled and positioned against the whole composer box", () => {
  assert.match(actions, /createPortal\(/);
  assert.match(actions, /closest<HTMLElement>\("\.composer-box"\)/);
  assert.match(actions, /const width = Math\.min\(anchorRect\.width, window\.innerWidth - VIEWPORT_MARGIN \* 2\)/);
  assert.match(actions, /style=\{\{ left: menuPosition\.left, top: menuPosition\.top, width: menuPosition\.width \|\| undefined/);
  const popover = ruleBody(".composer-add-menu__popover");
  assert.match(popover, /position\s*:\s*fixed/);
  assert.match(popover, /padding\s*:\s*4px 5px/);
  assert.match(popover, /border-radius\s*:\s*16px/);
  assert.match(popover, /box-shadow\s*:\s*none/);
  const menuItem = ruleBody(".composer-add-menu__popover>button");
  assert.match(menuItem, /height\s*:\s*30px/);
  assert.doesNotMatch(menuItem, /min-height/);
  assert.match(menuItem, /white-space\s*:\s*nowrap/);
  assert.match(menuItem, /border-radius\s*:\s*10px/);
  assert.match(menuItem, /padding\s*:\s*4px 10px/);
});
