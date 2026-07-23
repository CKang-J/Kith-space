import { z, ZodError } from "zod";
import { createHash } from "node:crypto";
import { isDesktopTrustedRequest } from "../../local-runtime/internalCredentials.js";
import { ModelConfigurationService } from "../../model-control/modelConfigurationService.js";
import { ModelControlError } from "../../model-control/contracts.js";
import { ModelProviderConnectionService } from "../../model-control/modelProviderConnectionService.js";
import { RuntimeProfileService } from "../../model-control/runtimeProfileService.js";
import { SettingsPresentationService } from "../../model-control/settingsPresentationService.js";
import { AdvisorBindingService } from "../../model-control/advisorBindingService.js";
import { CliConfigImportService } from "../../model-control/cliConfigImportService.js";
import { readJson, sendErr, sendJson } from "../util.js";
import type { HumanCtx } from "./ctx.js";
import { requestWorker, workerRuntimes } from "../../local-runtime/workerHub.js";
import { appDataConnection } from "../../app-data/appDatabase.js";
import { preflightEgress } from "../../advisor-provider/egressPreflight.js";
import { AdvisorProviderError } from "../../advisor-provider/contracts.js";

const SECRET_SHAPED_KEY = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i;

export function containsSecretShapedKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsSecretShapedKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    SECRET_SHAPED_KEY.test(key) || containsSecretShapedKey(nested, depth + 1));
}

const NonSecretRecordSchema = z.record(z.unknown()).refine(
  (value) => !containsSecretShapedKey(value),
  "secret-shaped keys are not allowed in persisted options",
);

const ProviderSchema = z.object({
  displayName: z.string().min(1).max(128),
  backendId: z.string().min(1).max(128),
  apiKind: z.string().min(1).max(128),
  canonicalOrigin: z.string().url().max(2048),
  networkClass: z.enum(["loopback", "lan", "public_cloud", "custom"]),
  credentialSourceKind: z.enum(["pi_cli_auth", "kith_secret", "env_ref", "keyless_local"]),
  credentialValue: z.string().min(1).max(65_536).optional(),
  credentialRef: z.string().max(512).nullable().optional(),
  credentialIdentityDigest: z.string().max(256).optional(),
  dataPolicyRevision: z.string().min(1).max(256),
  dataPolicyProvenance: z.enum(["vendor_verified", "human_asserted", "unknown"]),
  allowedEgress: z.array(z.string().url().max(2048)).min(1).max(16),
  capabilitySnapshot: NonSecretRecordSchema.optional(),
}).strict();

const ModelSchema = z.object({
  displayName: z.string().min(1).max(128),
  providerConnectionId: z.string().min(1).max(128),
  providerRevision: z.number().int().positive().optional(),
  modelId: z.string().min(1).max(256),
  reasoning: z.string().max(128).nullable().optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  inputCapabilities: z.array(z.string().min(1).max(64)).max(16).optional(),
  options: NonSecretRecordSchema.optional(),
}).strict();

const RuntimeSchema = z.object({
  enabled: z.boolean(),
  defaultBinding: z.object({
    mode: z.enum(["kith_model_configuration", "unmanaged_cli_native", "unset"]),
    modelConfigurationId: z.string().min(1).nullable(),
    modelConfigurationRevision: z.number().int().positive().nullable(),
  }).strict(),
  executablePreference: z.string().max(4096).nullable().optional(),
  runtimeOptions: NonSecretRecordSchema.optional(),
}).strict();
const AdvisorSchema = z.object({
  enabled: z.boolean().optional(),
  executorId: z.enum(["pi_sdk", "claude_cli"]).optional(),
  modelConfigurationId: z.string().min(1).max(128).optional(),
  modelConfigurationRevision: z.number().int().positive().optional(),
}).strict();

function presentProvider(item: ReturnType<ModelProviderConnectionService["get"]>) {
  const origin = new URL(item.revision.canonicalOrigin);
  return {
    id: item.connection.id, displayName: item.connection.displayName, status: item.connection.status,
    currentRevision: item.connection.currentRevision, backendId: item.revision.backendId,
    apiKind: item.revision.apiKind, destination: { host: origin.host, networkClass: item.revision.networkClass },
    credential: item.revision.credentialRef ? "configured" : "not_required",
    dataPolicyProvenance: item.revision.dataPolicyProvenance, updatedAt: item.connection.updatedAt,
  };
}

function handleError(ctx: HumanCtx, error: unknown): true {
  if (error instanceof ZodError) return (sendErr(ctx.res, 400, "invalid model settings request", { issues: error.issues }), true);
  if (error instanceof ModelControlError) {
    const code = error.code.endsWith("_not_found") ? 404 : error.code === "desktop_trust_required" ? 403 : 409;
    return (sendErr(ctx.res, code, error.message, { code: error.code }), true);
  }
  if (error instanceof AdvisorProviderError) {
    return (sendErr(ctx.res, 409, error.message, { code: error.code }), true);
  }
  throw error;
}

export async function handleModelSettings(ctx: HumanCtx): Promise<boolean> {
  if (!ctx.p.startsWith("/api/settings/")) return false;
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const runtimes = new RuntimeProfileService(configurations);
  const presenter = new SettingsPresentationService();
  const advisor = new AdvisorBindingService();
  const cliImports = new CliConfigImportService(runtimes);
  try {
    if (ctx.p === "/api/settings/model-providers" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: providers.list().map(presentProvider) });
      return true;
    }
    if (ctx.p === "/api/settings/model-providers" && ctx.method === "POST") {
      const body = ProviderSchema.parse(await readJson(ctx.req));
      if (body.credentialValue && !isDesktopTrustedRequest(ctx.req)) {
        throw new ModelControlError("desktop_trust_required");
      }
      sendJson(ctx.res, 201, presentProvider(await providers.create(body as any)));
      return true;
    }
    const providerMatch = /^\/api\/settings\/model-providers\/([^/]+)$/.exec(ctx.p);
    const providerTestMatch = /^\/api\/settings\/model-providers\/([^/]+)\/test$/.exec(ctx.p);
    if (providerTestMatch && ctx.method === "POST") {
      const provider = providers.get(providerTestMatch[1]!);
      const plan = await preflightEgress({
        canonicalOrigin: provider.revision.canonicalOrigin,
        networkClass: provider.revision.networkClass,
        allowedEgress: [...provider.revision.allowedEgress],
      });
      sendJson(ctx.res, 200, {
        ok: true,
        destination: { host: new URL(plan.canonicalOrigin).host, networkClass: plan.networkClass },
        redirectPolicy: plan.redirectPolicy,
      });
      return true;
    }
    if (providerMatch && ctx.method === "GET") {
      sendJson(ctx.res, 200, presentProvider(providers.get(providerMatch[1]!)));
      return true;
    }
    if (providerMatch && ctx.method === "PATCH") {
      const body = ProviderSchema.parse(await readJson(ctx.req));
      if (body.credentialValue && !isDesktopTrustedRequest(ctx.req)) throw new ModelControlError("desktop_trust_required");
      sendJson(ctx.res, 200, presentProvider(await providers.update(providerMatch[1]!, body as any)));
      return true;
    }
    if (providerMatch && ctx.method === "DELETE") {
      sendJson(ctx.res, 200, presentProvider(providers.setStatus(providerMatch[1]!, "disabled")));
      return true;
    }
    if (ctx.p === "/api/settings/model-configurations" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: configurations.list().map((item) => {
        const provider = providers.getRevision(item.revision.providerConnectionId, item.revision.providerRevision);
        return presenter.presentModelConfiguration({
          connection: provider.connection, provider: provider.revision,
          configuration: item.configuration, model: item.revision,
        });
      }) });
      return true;
    }
    if (ctx.p === "/api/settings/model-configurations" && ctx.method === "POST") {
      sendJson(ctx.res, 201, await configurations.create(ModelSchema.parse(await readJson(ctx.req))));
      return true;
    }
    const modelMatch = /^\/api\/settings\/model-configurations\/([^/]+)$/.exec(ctx.p);
    if (modelMatch && ctx.method === "GET") {
      sendJson(ctx.res, 200, configurations.get(modelMatch[1]!));
      return true;
    }
    if (modelMatch && ctx.method === "PATCH") {
      sendJson(ctx.res, 200, await configurations.update(modelMatch[1]!, ModelSchema.parse(await readJson(ctx.req))));
      return true;
    }
    if (modelMatch && ctx.method === "DELETE") {
      sendJson(ctx.res, 200, configurations.setStatus(modelMatch[1]!, "disabled"));
      return true;
    }
    if (ctx.p === "/api/settings/model-compatibility" && ctx.method === "GET") {
      sendJson(ctx.res, 200, { items: configurations.list().map(({ configuration, revision }) => ({
        configurationId: configuration.id, compatibility: revision.runtimeCompatibilitySnapshot,
      })) });
      return true;
    }
    if (ctx.p === "/api/settings/memory-advisor" && ctx.method === "GET") {
      sendJson(ctx.res, 200, advisor.summary());
      return true;
    }
    if (ctx.p === "/api/settings/memory-advisor" && ctx.method === "PATCH") {
      const body = AdvisorSchema.parse(await readJson(ctx.req));
      if (body.executorId) await advisor.setExecutor(body.executorId);
      if (body.modelConfigurationId) {
        await advisor.bindModelConfiguration(body.modelConfigurationId, body.modelConfigurationRevision);
      }
      if (body.enabled !== undefined) await advisor.setEnabled(body.enabled);
      sendJson(ctx.res, 200, advisor.summary());
      return true;
    }
    if (ctx.p === "/api/settings/cli-imports/preview" && ctx.method === "POST") {
      if (!isDesktopTrustedRequest(ctx.req)) throw new ModelControlError("desktop_trust_required");
      const body = z.object({ runtimeId: z.enum(["claude", "codex", "opencode", "pi"]) }).strict()
        .parse(await readJson(ctx.req));
      sendJson(ctx.res, 200, cliImports.preview(body.runtimeId));
      return true;
    }
    if (ctx.p === "/api/settings/cli-imports/apply" && ctx.method === "POST") {
      if (!isDesktopTrustedRequest(ctx.req)) throw new ModelControlError("desktop_trust_required");
      const body = z.object({
        runtimeId: z.enum(["claude", "codex", "opencode", "pi"]),
        sourceMtimeDigest: z.string().length(64),
      }).strict().parse(await readJson(ctx.req));
      sendJson(ctx.res, 200, await cliImports.apply(body.runtimeId, body.sourceMtimeDigest));
      return true;
    }
    const runtimeMatch = /^\/api\/settings\/runtimes\/([^/]+)$/.exec(ctx.p);
    const runtimeProbeMatch = /^\/api\/settings\/runtimes\/([^/]+)\/probe$/.exec(ctx.p);
    if (runtimeProbeMatch && ctx.method === "POST") {
      const runtimeId = z.enum(["claude", "codex", "opencode", "pi"]).parse(runtimeProbeMatch[1]);
      const result = await requestWorker({ type: "probe-models", runtime: runtimeId }, 8_000);
      const now = Date.now();
      const installed = workerRuntimes().includes(runtimeId);
      const status = installed
        ? "available"
        : String(result?.error ?? "").includes("ENOENT") ? "not_installed" : "error";
      const diagnostics = status === "available"
        ? {
          modelCount: Array.isArray(result?.models) ? result.models.length : null,
          modelDiscovery: Array.isArray(result?.models) ? "available" : "unavailable",
          rpcRequired: runtimeId === "pi",
          mcp: runtimeId === "pi" ? "unsupported" : "supported",
        }
        : { errorCode: status === "not_installed" ? "runtime_not_installed" : "runtime_probe_failed" };
      const capabilityDigest = createHash("sha256").update(JSON.stringify({
        runtimeId,
        models: Array.isArray(result?.models) ? result.models.map((item: any) => item?.id).filter(Boolean).sort() : [],
      })).digest("hex");
      appDataConnection().prepare(`
        INSERT INTO runtime_probe_cache (
          runtime_id, executable_digest, compiler_policy_version, observed_version, status,
          capability_digest, diagnostics_json, probed_at, expires_at
        ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_id) DO UPDATE SET
          executable_digest = excluded.executable_digest,
          compiler_policy_version = excluded.compiler_policy_version,
          observed_version = excluded.observed_version,
          status = excluded.status,
          capability_digest = excluded.capability_digest,
          diagnostics_json = excluded.diagnostics_json,
          probed_at = excluded.probed_at,
          expires_at = excluded.expires_at
      `).run(runtimeId, capabilityDigest, status, capabilityDigest, JSON.stringify(diagnostics), now, now + 60_000);
      sendJson(ctx.res, 200, runtimes.get(runtimeId));
      return true;
    }
    if (runtimeMatch && ctx.method === "GET") {
      sendJson(ctx.res, 200, runtimes.get(runtimeMatch[1] as any));
      return true;
    }
    if (runtimeMatch && ctx.method === "PATCH") {
      sendJson(ctx.res, 200, await runtimes.update(runtimeMatch[1] as any, RuntimeSchema.parse(await readJson(ctx.req))));
      return true;
    }
    return false;
  } catch (error) {
    return handleError(ctx, error);
  }
}
