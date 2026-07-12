// Unit tests for app-data and default Space path resolution (no DB / no disk).
// Run: npx tsx --test --test-force-exit test/paths.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import * as p from "../src/paths.ts";

const originalHome = process.env.KITH_SPACE_HOME;
const originalSpacesDir = process.env.KITH_SPACE_SPACES_DIR;
const originalLogDir = process.env.KITH_SPACE_LOG_DIR;

test.after(() => {
  if (originalHome === undefined) delete process.env.KITH_SPACE_HOME;
  else process.env.KITH_SPACE_HOME = originalHome;
  if (originalSpacesDir === undefined) delete process.env.KITH_SPACE_SPACES_DIR;
  else process.env.KITH_SPACE_SPACES_DIR = originalSpacesDir;
  if (originalLogDir === undefined) delete process.env.KITH_SPACE_LOG_DIR;
  else process.env.KITH_SPACE_LOG_DIR = originalLogDir;
});

test("defaults to ~/.kith-space when KITH_SPACE_HOME is unset", () => {
  delete process.env.KITH_SPACE_HOME;
  delete process.env.KITH_SPACE_SPACES_DIR;
  delete process.env.KITH_SPACE_LOG_DIR;
  const home = path.join(os.homedir(), ".kith-space");
  assert.equal(p.kithSpaceHome(), home);
  assert.equal(p.appDbFile(), path.join(home, "app.db"));
  assert.equal(p.defaultSpacesDir(), path.join(os.homedir(), "Kith-space"));
  assert.equal(p.userMemoryDir(), path.join(home, "memory"));
  assert.equal(p.spaceMemoryDir("/work/demo"), path.join("/work/demo", ".kith", "memory"));
  assert.equal(p.spaceUploadsDir("/work/demo"), path.join("/work/demo", ".kith", "uploads"));
  assert.equal(p.spaceAgentMemoryDir("/work/demo", "agent-1"), path.join("/work/demo", ".kith", "agents", "agent-1"));
  assert.equal(p.runtimeDir(), path.join(home, "runtime"));
  assert.equal(p.agentRuntimeStateDir("space-1", "agent-1"), path.join(home, "runtime", "space-1", "agent-1"));
  assert.equal(p.binDir(), path.join(home, "bin"));
  assert.equal(p.logsDir(), path.join(home, "logs"));
});

test("KITH_SPACE_HOME relocates app data without moving the default Space container", () => {
  process.env.KITH_SPACE_HOME = "/tmp/ot-wtX";
  delete process.env.KITH_SPACE_SPACES_DIR;
  delete process.env.KITH_SPACE_LOG_DIR;
  assert.equal(p.appDbFile(), path.join("/tmp/ot-wtX", "app.db"));
  assert.equal(p.defaultSpaceRoot("demo"), path.join(os.homedir(), "Kith-space", "demo"));
  assert.equal(p.userMemoryDir(), path.join("/tmp/ot-wtX", "memory"));
  assert.equal(p.spaceMemoryDir("/work/demo"), path.join("/work/demo", ".kith", "memory"));
  assert.equal(p.spaceUploadsDir("/work/demo"), path.join("/work/demo", ".kith", "uploads"));
  assert.equal(p.runtimeDir(), path.join("/tmp/ot-wtX", "runtime"));
  assert.equal(p.binDir(), path.join("/tmp/ot-wtX", "bin"));
  assert.equal(p.logsDir(), path.join("/tmp/ot-wtX", "logs"));
});

test("KITH_SPACE_SPACES_DIR independently relocates default Space roots", () => {
  process.env.KITH_SPACE_HOME = "/tmp/app-data";
  process.env.KITH_SPACE_SPACES_DIR = "/tmp/kith-spaces";
  assert.equal(p.defaultSpacesDir(), path.resolve("/tmp/kith-spaces"));
  assert.equal(p.defaultSpaceRoot("Home"), path.join(path.resolve("/tmp/kith-spaces"), "Home"));
  assert.equal(p.appDbFile(), path.join("/tmp/app-data", "app.db"));
});

test("KITH_SPACE_LOG_DIR remains an app-level override", () => {
  process.env.KITH_SPACE_HOME = "/tmp/ot-wtX";
  delete process.env.KITH_SPACE_SPACES_DIR;
  process.env.KITH_SPACE_LOG_DIR = "/var/log/ot";
  assert.equal(p.logsDir(), "/var/log/ot");
});
