import assert from "node:assert/strict";
import test from "node:test";
import { advisorProviderDescriptor, listAdvisorProviderDescriptors } from "./providerRegistry.js";

test("provider registry exposes only the two reviewed adapters", () => {
  assert.deepEqual(listAdvisorProviderDescriptors().map((item) => item.adapterId), ["pi_sdk", "claude_cli"]);
  assert.equal(advisorProviderDescriptor("pi_sdk").adapterVersion, "0.84.2");
  assert.equal(advisorProviderDescriptor("claude_cli").capabilities.toolIsolation, "enforced");
  assert.throws(() => advisorProviderDescriptor("dynamic-plugin"), /provider_unavailable/);
});
