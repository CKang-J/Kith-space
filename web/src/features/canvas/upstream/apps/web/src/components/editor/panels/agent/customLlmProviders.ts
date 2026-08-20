/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/customLlmProviders.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Custom LLM provider prefs (OpenAI-compatible). API keys never stored as plaintext. */

import type { LlmModel, ModelReferenceType } from '@recombyn-native/service/chat';
import { apiClient, apiQuery, queryClient } from '@recombyn-native/service/client';
import { getToken } from '@recombyn-native/utils/token';

type ByokProviderDto = {
  id: string;
  name: string;
  website?: string;
  baseUrl: string;
  apiModel: string;
  modelKind?: string;
  hasApiKey?: boolean;
  apiKeyHint?: string;
  createdAt?: number;
  updatedAt?: number;
};

type ByokListResponse = { items?: ByokProviderDto[] };

function invalidateByokListCache() {
  queryClient.invalidateQueries({ queryKey: apiQuery.meMeByokList.key() });
}

async function fetchByokProviders(): Promise<ByokProviderDto[]> {
  const data = (await queryClient.ensureQueryData({
    ...apiQuery.meMeByokList.queryOptions(),
    staleTime: 30_000,
  })) as ByokListResponse;
  return data.items || [];
}

async function upsertByokProvider(body: {
  id?: string;
  name: string;
  website?: string;
  baseUrl: string;
  apiModel: string;
  modelKind?: string;
  apiKey?: string;
}): Promise<ByokProviderDto> {
  const data = (await apiClient.meMeByokUpsert({ body })) as { item: ByokProviderDto };
  invalidateByokListCache();
  return data.item;
}

async function deleteByokProvider(providerId: string) {
  const res = await apiClient.meMeByokDelete({ params: { provider_id: providerId } });
  invalidateByokListCache();
  return res;
}

/**
 * User-facing model category when adding a custom provider.
 * ``platform`` = aggregator credential (one key unlocks catalog models).
 */
export type CustomModelKind = 'text' | 'vision' | 'image' | 'video' | 'platform';

export const PLATFORM_BYOK_ID_PREFIX = 'platform:';
export const PLATFORM_MODEL_ID_PREFIX = 'pm:';

export function isPlatformByokId(id: string | null | undefined): boolean {
  return Boolean(id && String(id).startsWith(PLATFORM_BYOK_ID_PREFIX));
}

export function isPlatformModelId(id: string | null | undefined): boolean {
  return Boolean(id && String(id).startsWith(PLATFORM_MODEL_ID_PREFIX));
}

/** ``pm:openrouter:xxx`` 鈫?``openrouter``. */
export function platformProviderFromModelId(id: string): string | null {
  if (!isPlatformModelId(id)) return null;
  const rest = String(id).slice(PLATFORM_MODEL_ID_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  const provider = rest.slice(0, idx).trim();
  return provider || null;
}

export function createPlatformModelId(platformProvider: string) {
  const p = String(platformProvider || '')
    .trim()
    .toLowerCase();
  return `${PLATFORM_MODEL_ID_PREFIX}${p}:${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export type CustomLlmProvider = {
  id: string;
  name: string;
  website: string;
  /** Plaintext only in memory after decrypt; persist as AES ciphertext or server vault. */
  apiKey: string;
  /** Ciphertext for localStorage when offline; empty when server-backed. */
  apiKeyCipher?: string;
  apiKeyHint?: string;
  baseUrl: string;
  /** Upstream chat model id (e.g. gpt-4o, deepseek-chat). */
  apiModel: string;
  /** text | vision(multimodal). Legacy ``image`` is normalized to text. */
  modelKind: CustomModelKind;
  /** Built-in brand icon key (openai / claude / doubao / 鈥?. */
  iconKey?: string;
  /** Custom uploaded icon (data URL or https). Takes precedence over iconKey in the picker. */
  iconUrl?: string;
  createdAt: number;
  /** True when key lives in server AES vault (no local ciphertext). */
  serverBacked?: boolean;
};

const STORAGE_KEY = 'recombyn.customLlmProviders.v1';
const DEVICE_KEY_STORAGE = 'recombyn.byok.deviceKey.v1';
export const CUSTOM_MODEL_ID_PREFIX = 'custom:';

export function isCustomModelId(id: string | null | undefined): boolean {
  return Boolean(id && String(id).startsWith(CUSTOM_MODEL_ID_PREFIX));
}

function normalizeModelKind(raw: unknown): CustomModelKind {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'vision' || v === 'multimodal' || v === 'multi') return 'vision';
  if (v === 'image' || v === 't2i' || v === 'i2i') return 'image';
  if (v === 'video' || v === 't2v' || v === 'i2v') return 'video';
  if (v === 'platform') return 'platform';
  return 'text';
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const existing = sessionStorage.getItem(DEVICE_KEY_STORAGE);
  if (existing) {
    const raw = b64ToBytes(existing);
    return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const exported = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(DEVICE_KEY_STORAGE, bytesToB64(exported));
  return key;
}

/** AES-256-GCM encrypt 鈥?ciphertext never logged. */
export async function encryptApiKeyLocal(plaintext: string): Promise<string> {
  const text = String(plaintext || '');
  if (!text) return '';
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return `enc:v1:${bytesToB64(packed)}`;
}

export async function decryptApiKeyLocal(cipher: string): Promise<string> {
  const raw = String(cipher || '');
  if (!raw.startsWith('enc:v1:')) return raw; // legacy plaintext migrate path
  try {
    const key = await getOrCreateDeviceKey();
    const packed = b64ToBytes(raw.slice('enc:v1:'.length));
    if (packed.length < 13) return '';
    const iv = packed.slice(0, 12);
    const ct = packed.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return '';
  }
}

function apiKeyHint(plaintext: string): string {
  const s = String(plaintext || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '****';
  return `鈥?{s.slice(-4)}`;
}

function mapDto(
  d: ByokProviderDto,
  keep?: Pick<CustomLlmProvider, 'iconKey' | 'iconUrl'>
): CustomLlmProvider {
  return {
    id: d.id,
    name: d.name || '',
    website: d.website || '',
    apiKey: '',
    apiKeyHint: d.apiKeyHint || '',
    baseUrl: String(d.baseUrl || '').replace(/\/+$/, ''),
    apiModel: String(d.apiModel || '').trim(),
    modelKind: normalizeModelKind(d.modelKind),
    iconKey: keep?.iconKey || '',
    iconUrl: keep?.iconUrl || '',
    createdAt: Number(d.createdAt) || Date.now(),
    serverBacked: true,
  };
}

function readLocalRaw(): CustomLlmProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p === 'object' && typeof p.id === 'string')
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        website: String(p.website || ''),
        apiKey: String(p.apiKey || ''),
        apiKeyCipher: p.apiKeyCipher ? String(p.apiKeyCipher) : undefined,
        apiKeyHint: p.apiKeyHint ? String(p.apiKeyHint) : undefined,
        baseUrl: String(p.baseUrl || '').replace(/\/+$/, ''),
        apiModel: String(p.apiModel || p.model || '').trim(),
        modelKind: normalizeModelKind(p.modelKind ?? p.kind),
        iconKey: String(p.iconKey || p.icon_key || '').trim(),
        iconUrl: String(p.iconUrl || p.icon_url || '').trim(),
        createdAt: Number(p.createdAt) || Date.now(),
        serverBacked: Boolean(p.serverBacked),
      }));
  } catch {
    return [];
  }
}

function writeLocalEncrypted(list: CustomLlmProvider[]) {
  try {
    // Persist ciphertext / hints only — never plaintext apiKey.
    const safe = list.map((p) => ({
      id: p.id,
      name: p.name,
      website: p.website,
      apiKeyCipher: p.apiKeyCipher || '',
      apiKeyHint: p.apiKeyHint || '',
      baseUrl: p.baseUrl,
      apiModel: p.apiModel || '',
      modelKind: p.modelKind,
      iconKey: p.iconKey || '',
      iconUrl: p.iconUrl || '',
      createdAt: p.createdAt,
      serverBacked: Boolean(p.serverBacked),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* ignore quota */
  }
}

/** Sync load for picker 鈥?keys may be empty until hydrate. */
export function loadCustomLlmProviders(): CustomLlmProvider[] {
  return readLocalRaw().map((p) => ({
    ...p,
    apiKey: '', // never keep plaintext in the sync snapshot
  }));
}

export function saveCustomLlmProviders(list: CustomLlmProvider[]) {
  writeLocalEncrypted(list);
}

export function createCustomLlmProviderId() {
  return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist a provider: server AES vault when logged in; else local AES-GCM.
 * Plaintext apiKey is never written to localStorage.
 * Platform-linked models (``pm:<provider>:鈥`) may omit apiKey and inherit
 * the parent platform credential's cipher.
 */
export async function persistCustomLlmProvider(
  provider: CustomLlmProvider
): Promise<CustomLlmProvider> {
  const token = getToken();
  let plain = String(provider.apiKey || '').trim();
  const tokenOrLocal = Boolean(token);

  if (!plain && isPlatformModelId(provider.id)) {
    const parentProv = platformProviderFromModelId(provider.id);
    const parentId = parentProv ? `${PLATFORM_BYOK_ID_PREFIX}${parentProv}` : '';
    if (token) {
      // Server copies the cipher from platform:<provider>.
      const item = await upsertByokProvider({
        id: provider.id,
        name: provider.name,
        website: provider.website,
        baseUrl: provider.baseUrl,
        apiModel: provider.apiModel,
        modelKind: provider.modelKind,
      });
      const mapped = mapDto(item, { iconKey: provider.iconKey, iconUrl: provider.iconUrl });
      const next = [mapped, ...loadCustomLlmProviders().filter((p) => p.id !== mapped.id)];
      writeLocalEncrypted(next);
      return mapped;
    }
    const parent = readLocalRaw().find((p) => p.id === parentId);
    if (!parent?.apiKeyCipher) {
      throw new Error('platform API key required first');
    }
    const stored: CustomLlmProvider = {
      ...provider,
      apiKey: '',
      apiKeyCipher: parent.apiKeyCipher,
      apiKeyHint: parent.apiKeyHint || provider.apiKeyHint,
      serverBacked: false,
    };
    const next = [stored, ...loadCustomLlmProviders().filter((p) => p.id !== stored.id)];
    writeLocalEncrypted(next);
    return stored;
  }

  if (tokenOrLocal && token) {
    const item = await upsertByokProvider({
      id: provider.id,
      name: provider.name,
      website: provider.website,
      baseUrl: provider.baseUrl,
      apiModel: provider.apiModel,
      modelKind: provider.modelKind,
      apiKey: plain || undefined,
    });
    const mapped = mapDto(item, { iconKey: provider.iconKey, iconUrl: provider.iconUrl });
    const next = [mapped, ...loadCustomLlmProviders().filter((p) => p.id !== mapped.id)];
    writeLocalEncrypted(next);
    return mapped;
  }
  let cipher = provider.apiKeyCipher || '';
  if (plain) {
    cipher = await encryptApiKeyLocal(plain);
  }
  const stored: CustomLlmProvider = {
    ...provider,
    apiKey: '',
    apiKeyCipher: cipher,
    apiKeyHint: plain ? apiKeyHint(plain) : provider.apiKeyHint,
    serverBacked: false,
  };
  const next = [stored, ...loadCustomLlmProviders().filter((p) => p.id !== stored.id)];
  writeLocalEncrypted(next);
  return { ...stored, apiKey: plain };
}

export async function removeCustomLlmProvider(id: string): Promise<void> {
  const token = getToken();
  if (token) {
    try {
      await deleteByokProvider(id);
    } catch {
      /* still clear local */
    }
  }
  writeLocalEncrypted(loadCustomLlmProviders().filter((p) => p.id !== id));
}

/** Single-flight 鈥?Account Agent mounts RoutePrefs + panel both used to call this. */
let _hydrateProvidersInflight: Promise<CustomLlmProvider[]> | null = null;

/** Pull server vault + migrate legacy plaintext local keys. */
export async function hydrateCustomLlmProviders(): Promise<CustomLlmProvider[]> {
  if (_hydrateProvidersInflight) return _hydrateProvidersInflight;

  let pending: Promise<CustomLlmProvider[]> | null = null;
  async function runHydrate(): Promise<CustomLlmProvider[]> {
    try {
      return await hydrateCustomLlmProvidersBody();
    } finally {
      if (_hydrateProvidersInflight === pending) _hydrateProvidersInflight = null;
    }
  }
  pending = runHydrate();
  _hydrateProvidersInflight = pending;
  return pending;
}

async function hydrateCustomLlmProvidersBody(): Promise<CustomLlmProvider[]> {
  const token = getToken();
  let local = readLocalRaw();

  // Migrate legacy plaintext 鈫?ciphertext (or server).
  const migrated: CustomLlmProvider[] = [];
  for (const p of local) {
    const plain = String(p.apiKey || '').trim();
    if (plain && !p.apiKeyCipher && !p.serverBacked) {
      if (token) {
        try {
          const item = await upsertByokProvider({
            id: p.id,
            name: p.name,
            website: p.website,
            baseUrl: p.baseUrl,
            apiModel: p.apiModel || p.name,
            modelKind: p.modelKind,
            apiKey: plain,
          });
          migrated.push(mapDto(item, { iconKey: p.iconKey, iconUrl: p.iconUrl }));
          continue;
        } catch {
          /* fall through to local encrypt */
        }
      }
      const cipher = await encryptApiKeyLocal(plain);
      migrated.push({
        ...p,
        apiKey: '',
        apiKeyCipher: cipher,
        apiKeyHint: apiKeyHint(plain),
        serverBacked: false,
      });
      continue;
    }
    migrated.push({ ...p, apiKey: '' });
  }
  local = migrated;
  writeLocalEncrypted(local);

  if (token) {
    try {
      const remote = await fetchByokProviders();
      const localById = new Map(local.map((p) => [p.id, p]));
      const byId = new Map(
        remote.map((d) => [
          d.id,
          mapDto(d, {
            iconKey: localById.get(d.id)?.iconKey,
            iconUrl: localById.get(d.id)?.iconUrl,
          }),
        ])
      );
      for (const p of local) {
        if (!byId.has(p.id) && p.apiKeyCipher) {
          // Push remaining local-only encrypted keys if we can decrypt.
          const plain = await decryptApiKeyLocal(p.apiKeyCipher);
          if (plain) {
            try {
              const item = await upsertByokProvider({
                id: p.id,
                name: p.name,
                website: p.website,
                baseUrl: p.baseUrl,
                apiModel: p.apiModel || p.name,
                modelKind: p.modelKind,
                apiKey: plain,
              });
              byId.set(item.id, mapDto(item, { iconKey: p.iconKey, iconUrl: p.iconUrl }));
            } catch {
              byId.set(p.id, p);
            }
          } else {
            byId.set(p.id, p);
          }
        }
      }
      const merged = Array.from(byId.values());
      writeLocalEncrypted(merged);
      return merged;
    } catch {
      /* keep local */
    }
  }
  return loadCustomLlmProviders();
}

function referenceTypesFor(kind: CustomModelKind): ModelReferenceType[] {
  if (kind === 'vision') return ['text', 'vision'];
  if (kind === 'image') return ['image'];
  return ['text'];
}

function llmKindFor(kind: CustomModelKind): NonNullable<LlmModel['kind']> {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  return 'text';
}

/** Map saved providers 鈫?entries for the model picker / route prefs. */
export function customProvidersAsModels(
  providers: CustomLlmProvider[] = loadCustomLlmProviders()
): LlmModel[] {
  return providers
    .filter((p) => !isPlatformByokId(p.id) && normalizeModelKind(p.modelKind) !== 'platform')
    .map((p) => {
      const modelKind = normalizeModelKind(p.modelKind);
      const isVision = modelKind === 'vision';
      return {
        id: `${CUSTOM_MODEL_ID_PREFIX}${p.id}`,
        label: p.name || 'Custom',
        provider: 'custom',
        kind: llmKindFor(modelKind),
        referenceTypes: referenceTypesFor(modelKind),
        maxAttachments: isVision ? 16 : 8,
        description: undefined,
        price: null,
        iconKey: p.iconKey || undefined,
        iconUrl: p.iconUrl || undefined,
      };
    });
}
