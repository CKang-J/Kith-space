// Unit tests for KITH_SPACE_HOME path resolution (no DB / no disk).
// Run: npx tsx --test --test-force-exit test/paths.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import * as p from "../src/paths.ts";

test("defaults to ~/.kith-space when KITH_SPACE_HOME is unset", () => {
  delete process.env.KITH_SPACE_HOME;
  delete process.env.KITH_SPACE_LOG_DIR;
  delete process.env.KITH_SPACE_UPLOAD_DIR;
  const home = path.join(os.homedir(), ".kith-space");
  assert.equal(p.kithSpaceHome(), home);
  assert.equal(p.registryDbFile(), path.join(home, "registry.db"));
  assert.equal(p.defaultWorkspacesDir(), path.join(os.homedir(), "Kith-space"));
  assert.equal(p.userMemoryDir(), path.join(home, "memory"));
  assert.equal(p.workspaceMemoryDir("/work/demo"), path.join("/work/demo", ".kith", "memory"));
  assert.equal(p.agentsDir(), path.join(home, "agents"));
  assert.equal(p.binDir(), path.join(home, "bin"));
  assert.equal(p.machineIdFile(), path.join(home, "machine-id"));
  assert.equal(p.logsDir(), path.join(home, "logs"));
  assert.equal(p.uploadsDir(), path.join(home, "uploads"));
});

test("KITH_SPACE_HOME relocates every derived dir", () => {
  process.env.KITH_SPACE_HOME = "/tmp/ot-wtX";
  delete process.env.KITH_SPACE_LOG_DIR;
  delete process.env.KITH_SPACE_UPLOAD_DIR;
  assert.equal(p.agentsDir(), path.join("/tmp/ot-wtX", "agents"));
  assert.equal(p.registryDbFile(), path.join("/tmp/ot-wtX", "registry.db"));
  assert.equal(p.defaultWorkspaceRoot("demo"), path.join("/tmp/ot-wtX", "workspaces", "demo"));
  assert.equal(p.userMemoryDir(), path.join("/tmp/ot-wtX", "memory"));
  assert.equal(p.workspaceMemoryDir("/work/demo"), path.join("/work/demo", ".kith", "memory"));
  assert.equal(p.binDir(), path.join("/tmp/ot-wtX", "bin"));
  assert.equal(p.machineIdFile(), path.join("/tmp/ot-wtX", "machine-id"));
  assert.equal(p.logsDir(), path.join("/tmp/ot-wtX", "logs"));
  assert.equal(p.uploadsDir(), path.join("/tmp/ot-wtX", "uploads"));
});

test("KITH_SPACE_LOG_DIR / KITH_SPACE_UPLOAD_DIR overrides still win", () => {
  process.env.KITH_SPACE_HOME = "/tmp/ot-wtX";
  process.env.KITH_SPACE_LOG_DIR = "/var/log/ot";
  process.env.KITH_SPACE_UPLOAD_DIR = "/var/up/ot";
  assert.equal(p.logsDir(), "/var/log/ot");
  assert.equal(p.uploadsDir(), "/var/up/ot");
});
