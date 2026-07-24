import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasPendingAdvisorJobs,
  memoryEvidencePath,
  memoryFreshness,
  memoryListPath,
  normalizedConfidence,
  revisionDraftIssue,
  revisionMutationPayload,
  statusForTab,
} from "./memoryPanelModel.ts";

test("structured memory filters remain server-owned", () => {
  const path = memoryListPath({
    agentId: "agent one", status: statusForTab("proposals"), query: "weekly plan", kind: "preference",
    scope: "agent_private", sourceAccessRevoked: true, page: 2, pageSize: 25,
  });
  const url = new URL(path, "http://local");
  assert.equal(url.pathname, "/api/memories");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ownerAgentId: "agent one", status: "proposed", page: "2", pageSize: "25", q: "weekly plan",
    kind: "preference", scope: "agent_private", sourceAccessRevoked: "true",
  });
});

test("memory freshness and persisted confidence are presented honestly", () => {
  assert.equal(memoryFreshness({ memory: { sourceAccess: "revoked" } as any, lastRecall: null }), "revoked");
  assert.equal(memoryFreshness({ memory: { sourceAccess: "available" } as any, lastRecall: null }), "never");
  assert.equal(normalizedConfidence(875), 0.875);
  assert.equal(normalizedConfidence(0.75), 0.75);
});

test("message evidence deep links require an available source surface", () => {
  assert.equal(memoryEvidencePath({
    slug: "my space", sourceKind: "message", sourceId: "message/1", sourceSurfaceId: "channel one", sourceAccess: "available",
  }), "/s/my%20space/channel/channel%20one?msg=message%2F1");
  assert.equal(memoryEvidencePath({
    slug: "space", sourceKind: "message", sourceId: "m1", sourceSurfaceId: "private", sourceAccess: "revoked",
  }), null);
  assert.equal(memoryEvidencePath({
    slug: "space", sourceKind: "turn", sourceId: "t1", sourceSurfaceId: "channel", sourceAccess: "available",
  }), null);
  assert.equal(memoryEvidencePath({
    slug: "space", sourceKind: "message", sourceId: "m1", sourceAccess: "available",
  }), null);
});

test("revision payload trims projections and requires replacement relation pairs", () => {
  const draft = {
    canonicalText: "  Prefer concise answers  ",
    internalSummary: "  concise  ",
    shareableSummary: "   ",
    replacementMemoryId: " replacement ",
    relationType: "supersedes" as const,
  };
  assert.equal(revisionDraftIssue("correct", draft), null);
  assert.deepEqual(revisionMutationPayload("correct", draft), {
    canonicalText: "Prefer concise answers",
    internalSummary: "concise",
    shareableSummary: null,
    replacementMemoryId: "replacement",
    relationType: "supersedes",
  });
  assert.equal(revisionDraftIssue("correct", { ...draft, relationType: "" }), "relation_pair_required");
  assert.equal(revisionDraftIssue("edit", { ...draft, canonicalText: " " }), "canonical_required");
});

test("advisor polling is active only for queued or running work", () => {
  assert.equal(hasPendingAdvisorJobs([{ status: "queued" }]), true);
  assert.equal(hasPendingAdvisorJobs([{ status: "running" }, { status: "succeeded" }]), true);
  assert.equal(hasPendingAdvisorJobs([{ status: "succeeded" }, { status: "failed" }]), false);
});
