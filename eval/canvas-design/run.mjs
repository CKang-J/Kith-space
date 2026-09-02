#!/usr/bin/env node
// Canvas design eval runner:
//   node eval/canvas-design/run.mjs --db <workspace.db> --canvas <canvasId> --task <taskId>
// Reads the canvas scene JSON from the Space DB, scores it against the task's
// checks (deterministic scorer in src/canvas/canvasEvalScore.ts), appends the
// result to eval/canvas-design/results.json and prints a per-check table.
// Exit code: 0 = all checks pass, 1 = any failure or input error.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import Database from "better-sqlite3";

const evalDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evalDir, "../..");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const dbPath = argOf("db");
const canvasId = argOf("canvas");
const taskId = argOf("task");
if (!dbPath || !canvasId || !taskId) {
  fail("usage: node eval/canvas-design/run.mjs --db <workspace.db> --canvas <canvasId> --task <taskId>");
}
if (!existsSync(dbPath)) fail(`workspace DB not found: ${dbPath}`);

const tasksDir = path.join(evalDir, "tasks");
const taskPath = path.join(tasksDir, `${taskId}.json`);
if (!existsSync(taskPath)) {
  const available = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, "")).join(", ")
    : "(tasks directory missing)";
  fail(`unknown task ${taskId}; available tasks: ${available}`);
}
const task = JSON.parse(readFileSync(taskPath, "utf8"));

const db = new Database(dbPath, { readonly: true });
const row = db.prepare(
  "SELECT id, title, document_json AS documentJson, revision, deleted_at AS deletedAt FROM canvas_documents WHERE id = ?",
).get(canvasId);
db.close();
if (!row) fail(`canvas ${canvasId} not found in ${dbPath}`);
if (row.deletedAt) fail(`canvas ${canvasId} is deleted; pick a live canvas`);

let document;
try {
  document = typeof row.documentJson === "string" ? JSON.parse(row.documentJson) : row.documentJson;
} catch (error) {
  fail(`canvas document is not valid JSON: ${error.message}`);
}
const nodeCount = document && typeof document === "object"
  ? Object.keys(document.deltaSetLike ?? {}).filter((id) => id !== "ROOT").length
  : 0;
if (nodeCount === 0) fail(`canvas ${canvasId} is empty; run the task prompt in the Agent first, then score the result`);

const scorer = await tsImport(pathToFileURL(path.join(repoRoot, "src/canvas/canvasEvalScore.ts")).href, import.meta.url);
let report;
try {
  report = scorer.evaluateCanvasChecks(document, task.checks);
} catch (error) {
  fail(error.message);
}

let gitRev = null;
let gitBranch = null;
try {
  gitRev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  gitBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
} catch {
  // outside a git checkout — record nulls
}

const entry = {
  timestamp: new Date().toISOString(),
  branch: gitBranch,
  gitRev,
  dbPath,
  canvasId,
  canvasTitle: row.title,
  canvasRevision: row.revision,
  taskId: task.id,
  surface: task.surface,
  expectedSkill: task.expectedSkill,
  checks: report.checks,
  passedCount: report.passedCount,
  totalCount: report.totalCount,
  passed: report.passed,
};
const resultsPath = path.join(evalDir, "results.json");
let results = [];
if (existsSync(resultsPath)) {
  const parsed = JSON.parse(readFileSync(resultsPath, "utf8"));
  if (!Array.isArray(parsed)) fail(`results.json is not an array; fix or remove ${resultsPath}`);
  results = parsed;
}
results.push(entry);
writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);

console.log(`canvas-design eval — task ${task.id} (${task.surface}, skill: ${task.expectedSkill})`);
console.log(`canvas ${canvasId} "${row.title}" revision=${row.revision} nodes=${nodeCount}`);
console.log(`recorded at ${entry.timestamp} on ${entry.branch ?? "?"}@${(entry.gitRev ?? "?").slice(0, 12)}`);
console.log("");
for (const check of report.checks) {
  console.log(
    check.check.padEnd(38),
    check.pass ? "PASS " : "FAIL ",
    check.detail.length <= 70 ? check.detail : `${check.detail.slice(0, 67)}...`,
  );
}
console.log("");
console.log(`${report.passedCount}/${report.totalCount} checks passed → ${report.passed ? "PASS" : "FAIL"} (appended to results.json)`);
process.exit(report.passed ? 0 : 1);
