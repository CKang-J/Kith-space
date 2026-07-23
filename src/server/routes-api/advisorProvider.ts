import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z, ZodError } from "zod";
import { AdvisorProviderSettingsService } from "../../advisor-provider/advisorProviderSettingsService.js";
import { compileAdvisorModel } from "../../advisor-provider/advisorModelCompiler.js";
import { AdvisorProviderError } from "../../advisor-provider/contracts.js";
import { providerCredentialPort } from "../../advisor-provider/credentialPort.js";
import { providerEpochGate } from "../../advisor-provider/providerEpochGate.js";
import { registerActiveAdvisorRun } from "../../advisor-provider/activeAdvisorRuns.js";
import { advisorProviderRuntimePort } from "../../runtime/control/advisorProviderRuntimeAdapter.js";
import { listPiSdkCatalog, piSdkCatalogDigest } from "../../advisor-provider/piSdkCatalog.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";

const ProfileSchema = z.object({
  sourceKind: z.enum(["bundled_catalog", "pi_cli_import", "manual"]),
  sourceSnapshotDigest: z.string().min(1).max(256),
  descriptorTrust: z.enum(["bundled_verified", "pi_cli_imported", "manual"]),
  backendId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(256),
  apiKind: z.enum(["anthropic-messages", "azure-openai-responses", "bedrock-converse-stream", "google-vertex", "openai-responses", "openai-completions", "openai-codex-responses", "google-generative-ai", "mistral-conversations", "pi-messages"]),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  canonicalOrigin: z.string().url().max(2048),
  region: z.string().max(128).optional(),
  tenantOrProjectDigest: z.string().max(256).optional(),
  credentialSourceKind: z.enum(["pi_cli_auth", "kith_secret", "env_ref", "keyless_local"]),
  credentialIdentityDigest: z.string().max(256).optional(),
  credentialValue: z.string().min(1).max(65_536).optional(),
  credentialRef: z.string().max(512).nullable().optional(),
  providerSchemaVersion: z.literal(1),
  dataPolicyRevision: z.string().min(1).max(256),
  dataPolicyProvenance: z.enum(["vendor_verified", "human_asserted", "unknown"]),
  networkClass: z.enum(["loopback", "lan", "public_cloud", "custom"]),
  allowedEgress: z.array(z.string().url().max(2048)).min(1).max(16),
  modelMetadata: z.record(z.unknown()),
}).strict();

function sendProviderError(ctx: HumanCtx, error: unknown): true {
  if (error instanceof ZodError) return (sendErr(ctx.res, 400, "invalid advisor provider request", { code: "MEMORY_INVALID", issues: error.issues }), true);
  if (error instanceof AdvisorProviderError) return (sendErr(ctx.res, 409, error.message, { code: error.code }), true);
  throw error;
}

export async function handleAdvisorProvider(ctx: HumanCtx): Promise<boolean> {
  if (!ctx.p.startsWith("/api/advisor-provider")) return false;
  const service = new AdvisorProviderSettingsService();
  try {
    if (ctx.p === "/api/advisor-provider" && ctx.method === "GET") {
      sendJson(ctx.res, 200, service.summary());
      return true;
    }
    if (ctx.p === "/api/advisor-provider/diagnostics" && ctx.method === "GET") {
      sendJson(ctx.res, 200, service.diagnostics());
      return true;
    }
    if (ctx.p === "/api/advisor-provider/runs" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: service.listRuns(Number(ctx.url.searchParams.get("limit") ?? 50)) });
      return true;
    }
    if (ctx.p === "/api/advisor-provider/catalog" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { sourceSnapshotDigest: piSdkCatalogDigest(), descriptors: listPiSdkCatalog() });
      return true;
    }
    if (ctx.p === "/api/advisor-provider/pi-cli/discover" && ctx.method === "GET") {
      const root = path.join(os.homedir(), ".pi", "agent");
      sendJson(ctx.res, 200, { available: existsSync(root), defaultRoot: root });
      return true;
    }
    if (ctx.p === "/api/advisor-provider/pi-cli/imports" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: service.listPiImports() });
      return true;
    }
    if (ctx.p === "/api/advisor-provider/pi-cli/import" && ctx.method === "POST") {
      const body = z.object({ root: z.string().min(1).max(4096), includeAuthProvider: z.string().min(1).max(128).optional() }).strict().parse(await readJson(ctx.req));
      sendJson(ctx.res, 200, service.importPiCli(body.root, body.includeAuthProvider));
      return true;
    }
    if (ctx.p === "/api/advisor-provider/model-profiles" && ctx.method === "POST") {
      sendJson(ctx.res, 201, await service.createModelProfile(ProfileSchema.parse(await readJson(ctx.req))));
      return true;
    }
    if (ctx.p === "/api/advisor-provider/select" && ctx.method === "POST") {
      const body = z.object({ adapterId: z.enum(["pi_sdk", "claude_cli"]) }).strict().parse(await readJson(ctx.req));
      sendJson(ctx.res, 200, await service.selectProvider(body.adapterId));
      return true;
    }
    if (ctx.p === "/api/advisor-provider/enabled" && ctx.method === "POST") {
      const body = z.object({ enabled: z.boolean() }).strict().parse(await readJson(ctx.req));
      sendJson(ctx.res, 200, await service.setEnabled(body.enabled));
      return true;
    }
    if (ctx.p === "/api/advisor-provider/rollback" && ctx.method === "POST") {
      sendJson(ctx.res, 200, await service.rollbackToLegacy());
      return true;
    }
    if (ctx.p === "/api/advisor-provider/probe" && ctx.method === "POST") {
      const execution = service.currentExecution();
      const prepared = await advisorProviderRuntimePort.prepare(execution.snapshot, compileAdvisorModel(execution.profile));
      const unregister = registerActiveAdvisorRun({
        runId: prepared.runId, spaceId: "__system__", agentId: "__probe__",
        cancel: () => advisorProviderRuntimePort.cancel(prepared.runId),
      });
      try {
        const handle = await providerEpochGate.withRead(execution.snapshot.providerEpoch, () => {
          const current = service.currentExecution();
          if (current.snapshot.executionSnapshotDigest !== execution.snapshot.executionSnapshotDigest) throw new AdvisorProviderError("provider_revision_changed");
          return providerCredentialPort.issue({
            credentialRef: execution.credentialRef, credentialSourceKind: execution.profile.credentialSourceKind,
            backendId: execution.profile.backendId, apiKind: execution.profile.apiKind,
            expectedCredentialIdentityDigest: prepared.snapshot.credentialIdentityDigest,
            runId: prepared.runId, providerEpoch: prepared.snapshot.providerEpoch, workerGeneration: prepared.workerGeneration,
            executionSnapshotDigest: prepared.snapshot.executionSnapshotDigest, expiresAt: Date.now() + 30_000,
          });
        });
        const result = await advisorProviderRuntimePort.complete(prepared,
          "This is a built-in non-sensitive capability test. Return exactly {\"schemaVersion\":1,\"candidates\":[]}.", handle);
        service.recordProbe(result.output.schemaVersion === 1, undefined, execution.snapshot);
        sendJson(ctx.res, 200, { ...service.summary(), preflight: prepared.preflight, testCandidateCount: result.output.candidates.length });
      } catch (error) {
        await advisorProviderRuntimePort.cancel(prepared.runId).catch(() => {});
        service.recordProbe(false, error instanceof AdvisorProviderError ? error.code : undefined, execution.snapshot);
        throw error;
      } finally { unregister(); }
      return true;
    }
    return false;
  } catch (error) { return sendProviderError(ctx, error); }
}
