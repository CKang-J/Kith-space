import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const home = mkdtempSync(path.join(os.tmpdir(), "kith-onboarding-"));
process.env.KITH_SPACE_HOME = home;

const { closeAppDatabase, registerHomeSpace } = await import("../app-data/appDatabase.js");
const { AgentOnboardingService } = await import("./agentOnboardingService.js");

test.after(() => {
  closeAppDatabase();
  rmSync(home, { recursive: true, force: true });
});

test("agent onboarding starts pending, completes once, and stays completed", () => {
  const service = new AgentOnboardingService();
  registerHomeSpace({ id: "home-1", name: "Home", slug: "home", rootPath: path.join(home, "home") });

  const initial = service.status();
  assert.equal(initial.pending, true);
  assert.equal(initial.completedAt, null);
  assert.equal(initial.homeSpaceId, "home-1");
  assert.equal(initial.homeAgentCount, 0);

  const completed = service.complete();
  assert.equal(completed.pending, false);
  assert.equal(completed.completedAt, completed.completedAt); // number

  const again = service.complete();
  assert.equal(again.pending, false);
  assert.equal(again.completedAt, completed.completedAt);
});
