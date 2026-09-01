import { createHash, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { canonicalAdvisorOrigin } from "./advisorModelCompiler.js";
import { ADVISOR_API_KINDS, type AdvisorApiKind, type AdvisorCredentialSourceKind, type AdvisorThinkingLevel } from "./contracts.js";
import { VerifiedConfigFileReader, type VerifiedConfigFile } from "./verifiedConfigFileReader.js";
import { piSdkModelRunnability } from "./advisorModelRunnability.js";
import { advisorCredentialEnvAllowed } from "./credentialEnvPolicy.js";

export type PiImportWarningCode =
  | "credential_command_unsupported"
  | "literal_secret_present"
  | "dangerous_env_rejected"
  | "compound_env_unsupported"
  | "oauth_expired"
  | "unknown_api"
  | "invalid_descriptor";

export interface PiImportWarning { code: PiImportWarningCode; pointer: string }
export interface ImportedAdvisorModelDescriptor {
  backendId: string;
  modelId: string;
  apiKind: string;
  canonicalOrigin: string;
  thinkingLevel: AdvisorThinkingLevel;
  credentialSourceKind: AdvisorCredentialSourceKind | "unsupported";
  credentialEnvRef?: string;
  advisorExecutable: boolean;
  descriptorTrust: "pi_cli_imported";
}
export interface PiCliImportResult {
  defaults: { provider?: string; model?: string; thinkingLevel?: AdvisorThinkingLevel };
  descriptors: ImportedAdvisorModelDescriptor[];
  warnings: PiImportWarning[];
  catalogDigest: string;
  secretSourceIdentity: string;
  fileIdentities: Record<string, string>;
  selectedCredentialAvailable: boolean;
  activationCredential?: { type: "api_key" | "oauth"; value: string; expires?: number };
}

const ENV_REF = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/;
const DANGEROUS_ENV = /^(?:NODE_OPTIONS|PATH|HOME|USERPROFILE|XDG_.*|SHELL|BASH_ENV|ENV|NPM_.*|PNPM_.*|ELECTRON_.*|KITH_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/;
const SECRET_FIELD = /(?:api[_-]?key|token|secret|password|authorization|credential|headers?)/i;

function parseJson(file: VerifiedConfigFile | null): Record<string, unknown> {
  if (!file) return {};
  let value: unknown;
  try { value = JSON.parse(file.buffer.toString("utf8")); } catch { throw new Error("config_file_untrusted: invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config_file_untrusted: root must be an object");
  return value as Record<string, unknown>;
}

function warning(warnings: PiImportWarning[], code: PiImportWarningCode, pointer: string): void {
  if (!warnings.some((item) => item.code === code && item.pointer === pointer)) warnings.push({ code, pointer });
}

function credentialSource(value: unknown, pointer: string, warnings: PiImportWarning[], backendId?: string, apiKind?: string): { kind: AdvisorCredentialSourceKind | "unsupported"; env?: string } {
  if (value === undefined || value === null || value === "") return { kind: "keyless_local" };
  if (typeof value !== "string") { warning(warnings, "invalid_descriptor", pointer); return { kind: "unsupported" }; }
  if (value.startsWith("!")) { warning(warnings, "credential_command_unsupported", pointer); return { kind: "unsupported" }; }
  const match = ENV_REF.exec(value);
  if (match) {
    const name = match[1] ?? match[2]!;
    if (DANGEROUS_ENV.test(name) || (backendId && apiKind && !advisorCredentialEnvAllowed(backendId, apiKind, name))) {
      warning(warnings, "dangerous_env_rejected", pointer); return { kind: "unsupported" };
    }
    return { kind: "env_ref", env: name };
  }
  if (value.includes("$") || value.includes("${")) { warning(warnings, "compound_env_unsupported", pointer); return { kind: "unsupported" }; }
  warning(warnings, "literal_secret_present", pointer);
  return { kind: "unsupported" };
}

function scanDangerous(value: unknown, pointer: string, warnings: PiImportWarning[], depth = 0, budget = { nodes: 0 }): void {
  if (!value || typeof value !== "object") return;
  if (depth > 32 || ++budget.nodes > 10_000) throw new Error("config_file_untrusted: structure limit");
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (SECRET_FIELD.test(key) && typeof child === "string") credentialSource(child, childPointer, warnings);
    if (key === "env" && child && typeof child === "object") {
      for (const envName of Object.keys(child as Record<string, unknown>)) if (DANGEROUS_ENV.test(envName)) warning(warnings, "dangerous_env_rejected", `${childPointer}/${envName}`);
    }
    scanDangerous(child, childPointer, warnings, depth + 1, budget);
  }
}

function modelsFrom(provider: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(provider.models) ? provider.models.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function frozenActivationCredential(value: unknown, now: number): PiCliImportResult["activationCredential"] | undefined {
  let credential: PiCliImportResult["activationCredential"] | undefined;
  if (typeof value === "string" && value.length > 0) credential = { type: "api_key", value };
  else if (value && typeof value === "object" && (value as any).type === "api_key"
    && typeof (value as any).key === "string" && (value as any).key.length > 0) {
    credential = { type: "api_key", value: (value as any).key };
  } else if (value && typeof value === "object" && (value as any).type === "oauth"
    && typeof (value as any).access === "string" && (value as any).access.length > 0
    && Number.isFinite((value as any).expires) && Number((value as any).expires) > now) {
    credential = { type: "oauth", value: (value as any).access, expires: Number((value as any).expires) };
  }
  if (!credential || credential.value.startsWith("!") || credential.value.includes("$")) return undefined;
  return credential;
}

export class PiCliConfigImporter {
  constructor(
    private readonly reader = new VerifiedConfigFileReader(),
    private readonly hmacKey: Buffer = randomBytes(32),
    private readonly now: () => number = Date.now,
  ) {}

  import(root: string, options: { includeAuthProvider?: string; includeCredential?: boolean } = {}): PiCliImportResult {
    const settingsFile = this.reader.read(root, "settings.json", true);
    const modelsFile = this.reader.read(root, "models.json", true);
    const authFile = options.includeAuthProvider ? this.reader.read(root, "auth.json", false) : null;
    const settings = parseJson(settingsFile);
    const models = parseJson(modelsFile);
    const auth = parseJson(authFile);
    const warnings: PiImportWarning[] = [];
    scanDangerous(models, "/models", warnings);
    if (options.includeAuthProvider) {
      const selected = auth[options.includeAuthProvider];
      scanDangerous(selected, `/auth/${options.includeAuthProvider}`, warnings);
      if (selected && typeof selected === "object" && (selected as any).type === "oauth") {
        if (!Number.isFinite((selected as any).expires) || Number((selected as any).expires) <= this.now()) warning(warnings, "oauth_expired", `/auth/${options.includeAuthProvider}/expires`);
      }
    }
    const selectedAuth = options.includeAuthProvider ? auth[options.includeAuthProvider] : undefined;
    const selectedActivationCredential = frozenActivationCredential(selectedAuth, this.now());
    const providerRoot = models.providers && typeof models.providers === "object" && !Array.isArray(models.providers)
      ? models.providers as Record<string, unknown>
      : models;
    const descriptors: ImportedAdvisorModelDescriptor[] = [];
    for (const [backendId, rawProvider] of Object.entries(providerRoot).slice(0, 64)) {
      if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) continue;
      const provider = rawProvider as Record<string, unknown>;
      const apiKind = typeof provider.api === "string" ? provider.api : "";
      const endpoint = typeof provider.baseUrl === "string" ? provider.baseUrl : "";
      const configuredSource = credentialSource(provider.apiKey ?? provider.api_key ?? provider.token, `/models/providers/${backendId}/credential`, warnings, backendId, apiKind);
      const source = backendId === options.includeAuthProvider && selectedActivationCredential ? { kind: "pi_cli_auth" as const } : configuredSource;
      let canonicalOrigin = "";
      let originValid = true;
      try { canonicalOrigin = canonicalAdvisorOrigin(endpoint, /^https?:\/\/(?:127\.|localhost|\[::1\])/.test(endpoint) ? "loopback" : "public_cloud"); }
      catch { originValid = false; warning(warnings, "invalid_descriptor", `/models/providers/${backendId}/baseUrl`); }
      const apiKnown = (ADVISOR_API_KINDS as readonly string[]).includes(apiKind);
      if (!apiKnown) warning(warnings, "unknown_api", `/models/providers/${backendId}/api`);
      for (const model of modelsFrom(provider).slice(0, 512)) {
        const modelId = typeof model.id === "string" ? model.id : "";
        const thinking = typeof model.thinkingLevel === "string" ? model.thinkingLevel as AdvisorThinkingLevel : "off";
        descriptors.push({
          backendId,
          modelId,
          apiKind,
          canonicalOrigin,
          thinkingLevel: thinking,
          credentialSourceKind: source.kind,
          ...(source.env ? { credentialEnvRef: source.env } : {}),
          advisorExecutable: Boolean(modelId && apiKnown && originValid && source.kind !== "unsupported"
            && piSdkModelRunnability({ backendId, modelId, apiKind, canonicalOrigin, thinkingLevel: thinking }).supported),
          descriptorTrust: "pi_cli_imported",
        });
      }
    }
    const defaults = {
      ...(typeof settings.defaultProvider === "string" ? { provider: settings.defaultProvider } : {}),
      ...(typeof settings.defaultModel === "string" ? { model: settings.defaultModel } : {}),
      ...((typeof settings.defaultThinkingLevel === "string") ? { thinkingLevel: settings.defaultThinkingLevel as AdvisorThinkingLevel } : {}),
    };
    const redactedCatalog = JSON.stringify({ defaults, descriptors, warnings });
    const files = [settingsFile, modelsFile, authFile].filter((file): file is VerifiedConfigFile => Boolean(file));
    const fileIdentities = Object.fromEntries(files.map((file) => {
      const name = file.path.split(/[\\/]/).pop()!;
      return [name, createHmac("sha256", this.hmacKey).update(`${name}\0${file.contentDigest}`).digest("hex")];
    }));
    const activationCredential = options.includeCredential ? selectedActivationCredential : undefined;
    return {
      defaults,
      descriptors,
      warnings,
      catalogDigest: createHash("sha256").update(redactedCatalog).digest("hex"),
      secretSourceIdentity: createHmac("sha256", this.hmacKey).update(files[0] ? path.dirname(files[0].path) : path.resolve(root)).update("\0")
        .update(Object.entries(fileIdentities).sort().map(([name, value]) => `${name}:${value}`).join("\0")).digest("hex"),
      fileIdentities,
      selectedCredentialAvailable: Boolean(options.includeAuthProvider && selectedActivationCredential),
      ...(activationCredential ? { activationCredential } : {}),
    };
  }
}
