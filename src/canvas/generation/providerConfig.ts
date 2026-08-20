import { randomUUID } from "node:crypto";
import { appDataConnection } from "../../app-data/appDatabase.js";
import { kithSpaceHome } from "../../paths.js";
import type { GenerationJobType, GenerationProvider } from "./contracts.js";
import { generationProviderType } from "./contracts.js";
import { apiKeyHint, decryptApiKey, encryptApiKey, getMasterKey } from "./providerCredentials.js";
import {
  DEFAULT_DOUBAO_IMAGE_MODEL,
  DEFAULT_SEEDREAM_VIDEO_MODEL,
} from "./arkModelCatalog.js";

export const DEFAULT_ARK_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3";
export { DEFAULT_DOUBAO_IMAGE_MODEL, DEFAULT_SEEDREAM_VIDEO_MODEL };

const SETTINGS_PROVIDER_NAMES = ["doubao", "seedream"] as const satisfies readonly GenerationProvider[];

export interface StoredProviderConfig {
  name: GenerationProvider;
  type: GenerationJobType;
  apiKey: string;
  endpoint: string;
  model?: string;
  enabled: boolean;
  source: "app.db" | "env";
}

export interface ProviderSettingsView {
  name: GenerationProvider;
  type: GenerationJobType;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  endpoint: string | null;
  model: string | null;
  source: "app.db" | "env" | "none";
}

export interface ArkSettingsView {
  hasApiKey: boolean;
  apiKeyHint: string | null;
  endpoint: string | null;
  source: "app.db" | "env" | "none";
  enabled: boolean;
}

export interface SaveProviderConfigInput {
  name: GenerationProvider;
  apiKey?: string;
  endpoint?: string | null;
  model?: string | null;
  enabled?: boolean;
}

type ProviderRow = {
  id: string;
  name: string;
  type: string;
  enabled: number;
  api_key_encrypted: string | null;
  api_endpoint: string | null;
  config_json: string | null;
  priority: number;
  created_at: number;
  updated_at: number;
};

function parseConfigJson(raw: string | null): { model?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const model = (parsed as { model?: unknown }).model;
    return typeof model === "string" && model.trim() ? { model: model.trim() } : {};
  } catch {
    return {};
  }
}

function envApiKey(name: GenerationProvider): string | undefined {
  if (name === "doubao") {
    return firstEnv("KITH_CANVAS_DOUBAO_API_KEY", "KITH_CANVAS_ARK_API_KEY");
  }
  if (name === "seedream") {
    return firstEnv("KITH_CANVAS_SEEDREAM_API_KEY", "KITH_CANVAS_ARK_API_KEY");
  }
  return undefined;
}

function envEndpoint(name: GenerationProvider): string | undefined {
  if (name === "doubao") return firstEnv("KITH_CANVAS_DOUBAO_ENDPOINT", "KITH_CANVAS_ARK_ENDPOINT");
  if (name === "seedream") return firstEnv("KITH_CANVAS_SEEDREAM_ENDPOINT", "KITH_CANVAS_ARK_ENDPOINT");
  return undefined;
}

function envModel(name: GenerationProvider): string | undefined {
  if (name === "doubao") return firstEnv("KITH_CANVAS_DOUBAO_MODEL");
  if (name === "seedream") return firstEnv("KITH_CANVAS_SEEDREAM_MODEL");
  return undefined;
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function defaultEndpoint(name: GenerationProvider): string {
  return envEndpoint(name) ?? DEFAULT_ARK_ENDPOINT;
}

function defaultModel(name: GenerationProvider): string | undefined {
  if (name === "doubao") return envModel(name) ?? DEFAULT_DOUBAO_IMAGE_MODEL;
  if (name === "seedream") return envModel(name) ?? DEFAULT_SEEDREAM_VIDEO_MODEL;
  return envModel(name);
}

async function decryptRow(row: ProviderRow, appDataDir: string): Promise<StoredProviderConfig | null> {
  if (!row.api_key_encrypted) return null;
  const masterKey = await getMasterKey(appDataDir);
  const apiKey = decryptApiKey(row.api_key_encrypted, masterKey);
  const extra = parseConfigJson(row.config_json);
  return {
    name: row.name as GenerationProvider,
    type: row.type as GenerationJobType,
    apiKey,
    endpoint: row.api_endpoint?.trim() || defaultEndpoint(row.name as GenerationProvider),
    model: extra.model ?? defaultModel(row.name as GenerationProvider),
    enabled: row.enabled === 1,
    source: "app.db",
  };
}

function envConfig(name: GenerationProvider): StoredProviderConfig | null {
  const apiKey = envApiKey(name);
  if (!apiKey) return null;
  return {
    name,
    type: generationProviderType(name),
    apiKey,
    endpoint: defaultEndpoint(name),
    model: defaultModel(name),
    enabled: true,
    source: "env",
  };
}

export async function saveProviderConfig(
  input: SaveProviderConfigInput,
  appDataDir = kithSpaceHome(),
): Promise<void> {
  const sqlite = appDataConnection();
  const existing = sqlite.prepare(`
    SELECT * FROM generation_providers WHERE name = ?
  `).get(input.name) as ProviderRow | undefined;
  const now = Date.now();
  const extra = parseConfigJson(existing?.config_json ?? null);
  if (input.model !== undefined) {
    if (input.model && input.model.trim()) extra.model = input.model.trim();
    else delete extra.model;
  }
  const configJson = Object.keys(extra).length ? JSON.stringify(extra) : null;
  const enabled = input.enabled === undefined ? (existing ? existing.enabled : 1) : (input.enabled ? 1 : 0);
  const endpoint = input.endpoint === undefined
    ? existing?.api_endpoint ?? null
    : (input.endpoint?.trim() || null);

  let encrypted = existing?.api_key_encrypted ?? null;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    if (!trimmed) encrypted = null;
    else {
      const masterKey = await getMasterKey(appDataDir);
      encrypted = encryptApiKey(trimmed, masterKey);
    }
  }

  if (existing) {
    sqlite.prepare(`
      UPDATE generation_providers
      SET enabled = ?, api_key_encrypted = ?, api_endpoint = ?, config_json = ?, updated_at = ?
      WHERE name = ?
    `).run(enabled, encrypted, endpoint, configJson, now, input.name);
    return;
  }

  sqlite.prepare(`
    INSERT INTO generation_providers (
      id, name, type, enabled, api_key_encrypted, api_endpoint, config_json, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    randomUUID(),
    input.name,
    generationProviderType(input.name),
    enabled,
    encrypted,
    endpoint,
    configJson,
    now,
    now,
  );
}

export async function getProviderConfig(
  name: GenerationProvider,
  appDataDir = kithSpaceHome(),
): Promise<StoredProviderConfig | null> {
  const sqlite = appDataConnection();
  const row = sqlite.prepare(`SELECT * FROM generation_providers WHERE name = ?`).get(name) as ProviderRow | undefined;
  if (row) {
    const stored = await decryptRow(row, appDataDir);
    if (stored) return stored;
  }
  return envConfig(name);
}

export async function listStoredProviderConfigs(
  appDataDir = kithSpaceHome(),
): Promise<StoredProviderConfig[]> {
  const sqlite = appDataConnection();
  const rows = sqlite.prepare(`SELECT * FROM generation_providers`).all() as ProviderRow[];
  const byName = new Map<GenerationProvider, StoredProviderConfig>();
  for (const row of rows) {
    const stored = await decryptRow(row, appDataDir);
    if (stored) byName.set(stored.name, stored);
  }
  for (const name of SETTINGS_PROVIDER_NAMES) {
    if (byName.has(name)) continue;
    const fromEnv = envConfig(name);
    if (fromEnv) byName.set(name, fromEnv);
  }
  return [...byName.values()];
}

export async function listProviderSettingsViews(
  appDataDir = kithSpaceHome(),
): Promise<ProviderSettingsView[]> {
  const sqlite = appDataConnection();
  const rows = sqlite.prepare(`SELECT * FROM generation_providers`).all() as ProviderRow[];
  const rowByName = new Map(rows.map((row) => [row.name as GenerationProvider, row]));
  const names = new Set<GenerationProvider>([
    ...SETTINGS_PROVIDER_NAMES,
    ...rows.map((row) => row.name as GenerationProvider),
  ]);
  const views: ProviderSettingsView[] = [];
  for (const name of names) {
    const row = rowByName.get(name);
    const stored = row ? await decryptRow(row, appDataDir) : null;
    const fromEnv = stored ? null : envConfig(name);
    const resolved = stored ?? fromEnv;
    views.push({
      name,
      type: generationProviderType(name),
      enabled: resolved?.enabled ?? (row ? row.enabled === 1 : false),
      hasApiKey: Boolean(resolved?.apiKey),
      apiKeyHint: resolved ? apiKeyHint(resolved.apiKey) : null,
      endpoint: resolved?.endpoint ?? row?.api_endpoint ?? null,
      model: resolved?.model ?? parseConfigJson(row?.config_json ?? null).model ?? defaultModel(name) ?? null,
      source: stored ? "app.db" : fromEnv ? "env" : "none",
    });
  }
  return views;
}

export function arkSettingsViewFromProviders(views: ProviderSettingsView[]): ArkSettingsView {
  const doubao = views.find((item) => item.name === "doubao");
  const seedream = views.find((item) => item.name === "seedream");
  const primary = doubao?.hasApiKey ? doubao : seedream?.hasApiKey ? seedream : doubao ?? seedream;
  return {
    hasApiKey: Boolean(doubao?.hasApiKey || seedream?.hasApiKey),
    apiKeyHint: primary?.apiKeyHint ?? null,
    endpoint: doubao?.endpoint || seedream?.endpoint || DEFAULT_ARK_ENDPOINT,
    source: primary?.source ?? "none",
    enabled: Boolean((doubao?.enabled ?? false) || (seedream?.enabled ?? false)),
  };
}

export async function saveArkSharedConfig(
  input: Omit<SaveProviderConfigInput, "name" | "model">,
  appDataDir = kithSpaceHome(),
): Promise<void> {
  for (const name of SETTINGS_PROVIDER_NAMES) {
    await saveProviderConfig({
      name,
      apiKey: input.apiKey,
      endpoint: input.endpoint,
      enabled: input.enabled,
    }, appDataDir);
  }
}
