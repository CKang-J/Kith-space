import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { appDataConnection, getContentHmacKey } from "../app-data/appDatabase.js";
import { providerCredentialPort } from "../advisor-provider/credentialPort.js";
import { PiCliConfigImporter } from "../advisor-provider/piCliConfigImporter.js";
import { canonicalAdvisorOrigin } from "../advisor-provider/advisorModelCompiler.js";
import type { AdvisorApiKind, AdvisorCredentialSourceKind } from "../advisor-provider/contracts.js";
import { VerifiedConfigFileReader } from "../advisor-provider/verifiedConfigFileReader.js";
import { ModelControlError } from "./contracts.js";
import { ModelProviderBundleService, type SaveProviderBundleInput } from "./modelProviderBundleService.js";
import { ModelProviderConnectionService } from "./modelProviderConnectionService.js";
import { ModelConfigurationService } from "./modelConfigurationService.js";
import { withRuntimeConfigurationChange } from "./runtimeConfigurationChange.js";
import { markAgentsForRuntimeConfigurationChange } from "./runtimeConfigurationImpact.js";

const IMPORTABLE_API_KINDS: ReadonlySet<AdvisorApiKind> = new Set<AdvisorApiKind>(
  ["anthropic-messages", "openai-responses", "openai-completions", "google-generative-ai"],
);

const ENV_REF = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/;
const DANGEROUS_ENV = /^(?:NODE_OPTIONS|PATH|HOME|USERPROFILE|XDG_.*|SHELL|BASH_ENV|ENV|NPM_.*|PNPM_.*|ELECTRON_.*|KITH_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/;

export type PiModelImportCredential =
  | { kind: "pi_cli_auth" }
  | { kind: "literal"; importable: boolean }
  | { kind: "env_ref"; env: string; importable: boolean }
  | { kind: "keyless_local" };

export interface PiModelImportProviderDraft {
  backendId: string;
  displayName: string;
  apiKind: AdvisorApiKind;
  canonicalOrigin: string;
  networkClass: "loopback" | "lan" | "public_cloud" | "custom";
  models: Array<{ id: string; name: string }>;
  credential: PiModelImportCredential;
  warnings: string[];
}

export interface PiModelImportPreview {
  root: string;
  providers: PiModelImportProviderDraft[];
  warnings: string[];
  sourceMtimeDigest: string;
  sourcePaths: string[];
  hasCredentialSecrets: boolean;
}

export interface PiModelImportApplyResult {
  preview: PiModelImportPreview;
  applied: number;
  skipped: string[];
  unchanged: boolean;
}

function parseJson(buffer: Buffer | null): Record<string, unknown> {
  if (!buffer) return {};
  let value: unknown;
  try { value = JSON.parse(buffer.toString("utf8")); } catch { throw new ModelControlError("import_conflict", "Pi config contains invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelControlError("import_conflict", "Pi config root must be an object");
  }
  return value as Record<string, unknown>;
}

function apiKeyCredential(value: unknown, warnings: string[], pointer: string): PiModelImportCredential {
  if (value === undefined || value === null || value === "") return { kind: "keyless_local" };
  if (typeof value !== "string") {
    warnings.push(`${pointer}: 凭据格式不受支持，已跳过`);
    return { kind: "keyless_local" };
  }
  if (value.startsWith("!")) {
    warnings.push(`${pointer}: 不导入命令式凭据（!command），请手动填写 API Key`);
    return { kind: "keyless_local" };
  }
  const match = ENV_REF.exec(value);
  if (match) {
    const name = match[1] ?? match[2]!;
    if (DANGEROUS_ENV.test(name)) {
      warnings.push(`${pointer}: 拒绝从危险环境变量 ${name} 读取凭据，请手动填写 API Key`);
      return { kind: "keyless_local" };
    }
    return { kind: "env_ref", env: name, importable: Boolean(process.env[name]) };
  }
  if (value.includes("$") || value.includes("${")) {
    warnings.push(`${pointer}: 不支持复合环境变量插值，请手动填写 API Key`);
    return { kind: "keyless_local" };
  }
  return { kind: "literal", importable: true };
}

function authCredentialAvailable(auth: Record<string, unknown>, backendId: string, now: number): boolean {
  const entry = auth[backendId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const candidate = entry as Record<string, unknown>;
  if (candidate.type === "api_key") {
    const key = candidate.key;
    return typeof key === "string" && key.length > 0 && !key.startsWith("!") && !key.includes("$");
  }
  if (candidate.type === "oauth") {
    return typeof candidate.access === "string" && candidate.access.length > 0
      && Number.isFinite(candidate.expires) && Number(candidate.expires) > now;
  }
  return false;
}

/** Root used by both preview and the pi_cli_auth redemption path (~/.pi/agent). */
export function piAgentConfigRoot(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

/**
 * Read-only, sanitized import of the user's local Pi CLI configuration into
 * Kith model provider connections + model configurations. Same security
 * boundary as PiCliConfigImporter: no !command resolution, no compound env
 * interpolation, dangerous env names rejected, symlinks/oversized files
 * rejected, and nothing is ever written back to the Pi CLI configuration.
 */
export class PiConfigModelImportService {
  constructor(
    private readonly providers = new ModelProviderConnectionService(),
    private readonly configurations = new ModelConfigurationService(providers),
    private readonly bundles = new ModelProviderBundleService(providers, configurations),
    private readonly reader = new VerifiedConfigFileReader(),
    private readonly now: () => number = Date.now,
  ) {}

  preview(root: string = piAgentConfigRoot()): PiModelImportPreview {
    const importer = new PiCliConfigImporter(this.reader, getContentHmacKey(), this.now);
    const scan = importer.import(root);
    const modelsFile = this.reader.read(root, "models.json", true);
    const authFile = this.reader.read(root, "auth.json", true);
    const models = parseJson(modelsFile?.buffer ?? null);
    const auth = parseJson(authFile?.buffer ?? null);
    const warnings = [...scan.warnings.map((item) => `${item.pointer}: ${item.code}`)];
    const providerRoot = models.providers && typeof models.providers === "object" && !Array.isArray(models.providers)
      ? models.providers as Record<string, unknown>
      : models;
    const providers: PiModelImportProviderDraft[] = [];
    for (const [backendId, rawProvider] of Object.entries(providerRoot).slice(0, 64)) {
      const draftWarnings: string[] = [];
      if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) continue;
      const provider = rawProvider as Record<string, unknown>;
      const apiKind = typeof provider.api === "string" ? provider.api : "";
      if (!IMPORTABLE_API_KINDS.has(apiKind as AdvisorApiKind)) {
        draftWarnings.push(`接口类型 ${apiKind || "(未设置)"} 暂不支持，已跳过`);
        continue;
      }
      const importableApiKind = apiKind as AdvisorApiKind;
      const endpoint = typeof provider.baseUrl === "string" ? provider.baseUrl : "";
      let canonicalOrigin = "";
      let networkClass: PiModelImportProviderDraft["networkClass"] = "public_cloud";
      try {
        networkClass = /^https?:\/\/(?:127\.|localhost|\[::1\])/.test(endpoint) ? "loopback" : "public_cloud";
        canonicalOrigin = canonicalAdvisorOrigin(endpoint, networkClass);
      } catch {
        draftWarnings.push(`API 地址无效，已跳过`);
        continue;
      }
      const modelList = Array.isArray(provider.models)
        ? provider.models.filter((item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
            && typeof (item as Record<string, unknown>).id === "string").slice(0, 512)
        : [];
      const modelsDraft = modelList.map((item) => ({
        id: String(item.id),
        name: typeof item.name === "string" && item.name ? item.name : String(item.id),
      }));
      if (modelsDraft.length === 0) {
        draftWarnings.push("没有可导入的模型，已跳过");
        continue;
      }
      const configured = apiKeyCredential(
        provider.apiKey ?? provider.api_key ?? provider.token,
        draftWarnings,
        `models.json/providers/${backendId}/apiKey`,
      );
      const credential: PiModelImportCredential = authCredentialAvailable(auth, backendId, this.now())
        ? { kind: "pi_cli_auth" }
        : configured;
      providers.push({
        backendId,
        displayName: backendId,
        apiKind: importableApiKind,
        canonicalOrigin,
        networkClass,
        models: modelsDraft,
        credential,
        warnings: draftWarnings,
      });
    }
    const fileIdentities = [modelsFile, authFile].filter((file) => file != null)
      .map((file) => file!.contentDigest);
    const sourceMtimeDigest = createHash("sha256").update(fileIdentities.join("\0")).digest("hex");
    return {
      root,
      providers,
      warnings,
      sourceMtimeDigest,
      sourcePaths: [path.join(root, "models.json"), path.join(root, "auth.json")],
      hasCredentialSecrets: providers.some((provider) =>
        provider.credential.kind === "pi_cli_auth"
        || provider.credential.kind === "literal"
        || (provider.credential.kind === "env_ref" && provider.credential.importable)),
    };
  }

  async apply(root: string, expectedSourceMtimeDigest: string): Promise<PiModelImportApplyResult> {
    const preview = this.preview(root);
    if (preview.sourceMtimeDigest !== expectedSourceMtimeDigest) {
      throw new ModelControlError("import_conflict", "Pi configuration changed after preview");
    }
    const previous = appDataConnection().prepare(`
      SELECT source_mtime_digest FROM cli_config_import_snapshots
      WHERE runtime_id = 'pi' ORDER BY created_at DESC, id DESC LIMIT 1
    `).get() as { source_mtime_digest: string } | undefined;
    if (previous?.source_mtime_digest === preview.sourceMtimeDigest && preview.providers.length === 0) {
      return { preview, applied: 0, skipped: [], unchanged: true };
    }
    const existing = new Set(this.providers.list()
      .filter((item) => item.connection.status === "active")
      .map((item) => item.revision.backendId));
    const drafts = preview.providers.filter((provider) => !existing.has(provider.backendId));
    const skipped = preview.providers
      .filter((provider) => existing.has(provider.backendId))
      .map((provider) => provider.backendId);
    if (drafts.length === 0) {
      return { preview, applied: 0, skipped, unchanged: previous?.source_mtime_digest === preview.sourceMtimeDigest };
    }
    const secretSourceIdentity = new PiCliConfigImporter(this.reader, getContentHmacKey(), this.now)
      .import(root).secretSourceIdentity;
    const applied = await withRuntimeConfigurationChange(() => {
      const sqlite = appDataConnection();
      const result = sqlite.transaction(() => {
        let count = 0;
        for (const draft of drafts) {
          const input = this.credentialInput(draft, root, secretSourceIdentity);
          const provider = this.providers.createWithinConfigurationChange(input);
          for (const model of draft.models.slice(0, 256)) {
            this.configurations.createWithinConfigurationChange({
              displayName: model.name,
              providerConnectionId: provider.connection.id,
              modelId: model.id,
            });
          }
          count += 1;
        }
        return count;
      }).immediate();
      markAgentsForRuntimeConfigurationChange({ runtimeIds: ["pi", "pi-builtin"] });
      return result;
    });
    const snapshot = appDataConnection().prepare(`
      INSERT INTO cli_config_import_snapshots (
        id, runtime_id, source_paths_digest, source_mtime_digest, sanitized_payload_json, warnings_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    snapshot.run(
      randomUUID(),
      "pi",
      createHash("sha256").update(preview.sourcePaths.join("\0")).digest("hex"),
      preview.sourceMtimeDigest,
      JSON.stringify(preview.providers.map((provider) => ({
        backendId: provider.backendId,
        apiKind: provider.apiKind,
        canonicalOrigin: provider.canonicalOrigin,
        modelIds: provider.models.map((model) => model.id),
        credentialKind: provider.credential.kind,
      }))),
      JSON.stringify([...preview.warnings, ...preview.providers.flatMap((provider) => provider.warnings)]),
      Date.now(),
    );
    return { preview, applied, skipped, unchanged: false };
  }

  private credentialInput(
    draft: PiModelImportProviderDraft,
    root: string,
    secretSourceIdentity: string,
  ): SaveProviderBundleInput["provider"] {
    const base = {
      displayName: draft.displayName,
      backendId: draft.backendId,
      apiKind: draft.apiKind,
      canonicalOrigin: draft.canonicalOrigin,
      networkClass: draft.networkClass,
      dataPolicyRevision: "human-confirmed-v1",
      dataPolicyProvenance: "human_asserted" as const,
      allowedEgress: [draft.canonicalOrigin],
      capabilitySnapshot: {},
      sourceKind: "pi_import" as const,
      sourceSnapshotDigest: `pi_import:${secretSourceIdentity}`,
    };
    if (draft.credential.kind === "pi_cli_auth") {
      const stored = providerCredentialPort.storePiCliSource(draft.backendId, root, secretSourceIdentity);
      return {
        ...base,
        credentialSourceKind: "pi_cli_auth" as AdvisorCredentialSourceKind,
        credentialRef: stored.credentialRef,
        credentialIdentityDigest: stored.credentialIdentityDigest,
      };
    }
    if (draft.credential.kind === "literal" && draft.credential.importable) {
      const literal = this.readLiteralApiKey(root, draft.backendId);
      if (literal) {
        const stored = providerCredentialPort.storeKithSecret(draft.backendId, literal);
        return {
          ...base,
          credentialSourceKind: "kith_secret",
          credentialRef: stored.credentialRef,
          credentialIdentityDigest: stored.credentialIdentityDigest,
        };
      }
    }
    if (draft.credential.kind === "env_ref" && draft.credential.importable) {
      const value = process.env[draft.credential.env];
      if (value) {
        const stored = providerCredentialPort.storeKithSecret(draft.backendId, value);
        return {
          ...base,
          credentialSourceKind: "kith_secret",
          credentialRef: stored.credentialRef,
          credentialIdentityDigest: stored.credentialIdentityDigest,
        };
      }
    }
    return { ...base, credentialSourceKind: "keyless_local" };
  }

  private readLiteralApiKey(root: string, backendId: string): string | null {
    const modelsFile = this.reader.read(root, "models.json", true);
    if (!modelsFile) return null;
    const models = parseJson(modelsFile.buffer);
    const providerRoot = models.providers && typeof models.providers === "object" && !Array.isArray(models.providers)
      ? models.providers as Record<string, unknown>
      : models;
    const provider = providerRoot[backendId];
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) return null;
    const value = (provider as Record<string, unknown>).apiKey
      ?? (provider as Record<string, unknown>).api_key
      ?? (provider as Record<string, unknown>).token;
    return typeof value === "string" && value.length > 0
      && !value.startsWith("!") && !value.includes("$") && value.length <= 64 * 1024
      ? value : null;
  }
}
