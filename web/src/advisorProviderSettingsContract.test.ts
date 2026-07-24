import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Memory Advisor settings expose provider/model revisions, safe Pi import, policy, egress, and capability probe", () => {
  const settings = source("./views/advisor-provider/AdvisorProviderSettings.tsx");
  const shell = source("./views/misc.tsx");
  assert.match(shell, /\["advisor", "misc\.settingsNavAdvisor"\]/);
  for (const endpoint of ["/api/advisor-provider", "/pi-cli/import", "/model-profiles", "/select", "/probe"]) {
    assert.ok(settings.includes(endpoint), `missing ${endpoint}`);
  }
  for (const field of ["dataPolicyRevision", "dataPolicyProvenance", "networkClass", "allowedEgress", "credentialSourceKind"]) {
    assert.ok(settings.includes(field), `missing ${field}`);
  }
  assert.match(settings, /advisorExecutable/);
  assert.match(settings, /type="password"/);
  assert.doesNotMatch(settings, /localStorage|sessionStorage/);
});

test("Agent Memory panel makes exact consent and revocation explicit without changing Files Memory", () => {
  const panel = source("./views/agent-memory/AgentMemoryPanel.tsx");
  const card = source("./views/agent-memory/AdvisorStatusCard.tsx");
  assert.match(panel, /memory-advisor\/consent/);
  assert.match(panel, /memory-advisor\/revoke/);
  assert.match(card, /approvedProviderRevision === system\.provider\.revision/);
  assert.match(card, /approvedModelProfileRevision === system\.modelProfile\.revision/);
  assert.match(panel, /<FilesMemoryView agentId=\{agentId\}/);
});

test("Advisor status keeps its hook order stable while async state is loading", () => {
  const card = source("./views/agent-memory/AdvisorStatusCard.tsx");
  const loadingReturn = card.indexOf("if (!state) return");
  assert.ok(loadingReturn > 0);
  assert.ok(card.lastIndexOf("useState(", loadingReturn) > 0);
  assert.ok(card.lastIndexOf("useEffect(", loadingReturn) > 0);
  assert.equal(card.indexOf("useState(", loadingReturn), -1);
  assert.equal(card.indexOf("useEffect(", loadingReturn), -1);
});
