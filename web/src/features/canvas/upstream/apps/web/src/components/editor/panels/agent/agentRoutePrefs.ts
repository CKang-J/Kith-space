/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/agentRoutePrefs.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Agent Auto-routing prefs: types, localStorage, API overrides, region caches.
 */

import { listModels } from '@recombyn-native/service/chat';
import { fetchDesignCatalog } from '@/features/canvas/adapters/recombynStageOneDesign';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { isCustomModelId } from './customLlmProviders';

export type AgentRoutePreset = 'platform' | 'economy' | 'balanced' | 'quality' | 'custom';

export type AgentRoutePrefs = {
  preset: AgentRoutePreset;
  fast?: string;
  standard?: string;
  reasoning?: string;
  vision?: string;
  image?: string;
};

const ROUTE_PREFS_KEY = 'recombyn.agentRoutePrefs.v1';

/** Code fallback if Admin has not seeded precheck.user_preset.* yet. */
const ROUTE_PRESETS_FALLBACK: Record<
  Exclude<AgentRoutePreset, 'platform' | 'custom'>,
  AgentRoutePrefs
> = {
  /** Legacy key — same domestic ladder as 标准版 platform defaults. */
  economy: {
    preset: 'economy',
    fast: 'doubao-seed-2-1-turbo',
    standard: 'deepseek-v4-flash',
    reasoning: 'deepseek-v4-pro',
    vision: 'doubao-seed-2-1-turbo',
    image: 'doubao-seedream-5-0-lite',
  },
  balanced: {
    preset: 'balanced',
    fast: 'doubao-seed-2-1-turbo',
    standard: 'or-gpt-5-6-luna',
    reasoning: 'or-gemini-3-flash-preview',
    vision: 'or-gemini-3-flash-preview',
    image: 'or-gpt-image-2',
  },
  quality: {
    preset: 'quality',
    fast: 'or-gemini-3-flash-preview',
    standard: 'or-gemini-3-5-flash',
    reasoning: 'or-gpt-5-6-sol',
    vision: 'or-gemini-3-5-flash',
    image: 'or-gpt-image-2',
  },
};

/** Retired catalog ids still lingering in prefs / Admin preset rows. */
const RETIRED_ROUTE_MODEL_IDS: Record<string, string> = {
  'or-gpt-image-1': 'or-gpt-image-2',
  'or-gpt-image-1-mini': 'or-gpt-image-2',
};

function remapRetiredRouteModelId(id: string | undefined): string | undefined {
  const v = String(id || '').trim();
  if (!v) return id;
  return RETIRED_ROUTE_MODEL_IDS[v] || v;
}

function remapRetiredRoutePrefs(prefs: AgentRoutePrefs): AgentRoutePrefs {
  return {
    ...prefs,
    fast: remapRetiredRouteModelId(prefs.fast),
    standard: remapRetiredRouteModelId(prefs.standard),
    reasoning: remapRetiredRouteModelId(prefs.reasoning),
    vision: remapRetiredRouteModelId(prefs.vision),
    image: remapRetiredRouteModelId(prefs.image),
  };
}

let cachedPresetRules: Record<string, string> | null = null;
/** From GET /chat/models — null until first fetch. */
let cachedOpenrouterAvailable: boolean | null = null;

function isOpenRouterModelId(id: string | undefined): boolean {
  const s = String(id || '').trim().toLowerCase();
  return s.startsWith('or-') || s.startsWith('openrouter/');
}

function remapPrefsWithoutOpenRouter(prefs: AgentRoutePrefs): AgentRoutePrefs {
  const domestic = resolveNamedPreset('economy');
  const out: AgentRoutePrefs = { ...prefs };
  for (const key of ['fast', 'standard', 'reasoning', 'vision', 'image'] as const) {
    if (isOpenRouterModelId(out[key])) {
      out[key] = domestic[key];
    }
  }
  return out;
}

export function resolvePresetForRegion(
  name: Exclude<AgentRoutePreset, 'platform' | 'custom'>,
  rules?: Record<string, string> | null
): AgentRoutePrefs {
  const base = resolveNamedPreset(name, rules);
  if (cachedOpenrouterAvailable === false) {
    return { ...remapPrefsWithoutOpenRouter(base), preset: name };
  }
  return base;
}

function migrateLegacyRouteKeys(raw: Record<string, unknown>): Partial<AgentRoutePrefs> {
  const out: Partial<AgentRoutePrefs> = {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = String(raw[k] || '').trim();
      if (v) return v;
    }
    return undefined;
  };
  out.fast = pick('fast', 'simple');
  out.standard = pick('standard', 'medium');
  out.reasoning = pick('reasoning', 'complex');
  out.vision = pick('vision');
  out.image = pick('image');
  return out;
}

function parseUserPresetRoutes(raw: string): Partial<AgentRoutePrefs> {
  const bag: Record<string, unknown> = {};
  for (const part of String(raw || '').split(';')) {
    const p = part.trim();
    if (!p.includes('->')) continue;
    const [left, right] = p.split('->', 2).map((s) => s.trim());
    const key = left.toLowerCase();
    const val = (right || '').trim();
    if (!val) continue;
    if (
      key === 'fast' ||
      key === 'standard' ||
      key === 'reasoning' ||
      key === 'simple' ||
      key === 'medium' ||
      key === 'complex' ||
      key === 'vision' ||
      key === 'image'
    ) {
      bag[key] = val;
    }
  }
  return migrateLegacyRouteKeys(bag);
}

export function resolveNamedPreset(
  name: Exclude<AgentRoutePreset, 'platform' | 'custom'>,
  rules?: Record<string, string> | null
): AgentRoutePrefs {
  const fallback = ROUTE_PRESETS_FALLBACK[name];
  const source = rules ?? cachedPresetRules;
  const raw = source?.[`precheck.user_preset.${name}`] || '';
  const parsed = parseUserPresetRoutes(raw);
  return remapRetiredRoutePrefs({
    preset: name,
    fast: parsed.fast || fallback.fast,
    standard: parsed.standard || fallback.standard,
    reasoning: parsed.reasoning || fallback.reasoning,
    vision: parsed.vision || fallback.vision,
    image: parsed.image || fallback.image,
  });
}

export function emptyCustomRoutePrefs(): AgentRoutePrefs {
  return {
    preset: 'custom',
    fast: '',
    standard: '',
    reasoning: '',
    vision: '',
    image: '',
  };
}

/** Resolve editable lane ids for Auto (named presets → concrete models). */
export function seedCustomLaneFromPrefs(prefs: AgentRoutePrefs): AgentRoutePrefs {
  if (prefs.preset === 'custom') return prefs;
  if (prefs.preset === 'balanced' || prefs.preset === 'quality' || prefs.preset === 'economy') {
    return resolvePresetForRegion(prefs.preset);
  }
  // platform → domestic Auto defaults
  return resolvePresetForRegion('economy');
}

export function loadAgentRoutePrefs(rules?: Record<string, string> | null): AgentRoutePrefs {
  // Local desktop: no platform catalog — only custom/BYOK lane picks.
  if (isDesktopLocal()) {
    try {
      const raw = localStorage.getItem(ROUTE_PREFS_KEY);
      if (!raw) return emptyCustomRoutePrefs();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return emptyCustomRoutePrefs();
      const migrated = migrateLegacyRouteKeys(parsed);
      const keep = (id: string | undefined) =>
        isCustomModelId(String(id || '').trim()) ? String(id).trim() : '';
      return remapRetiredRoutePrefs({
        preset: 'custom',
        fast: keep(migrated.fast),
        standard: keep(migrated.standard),
        reasoning: keep(migrated.reasoning),
        vision: keep(migrated.vision),
        image: keep(migrated.image),
      });
    } catch {
      return emptyCustomRoutePrefs();
    }
  }
  try {
    const raw = localStorage.getItem(ROUTE_PREFS_KEY);
    if (!raw) return { preset: 'platform' };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { preset: 'platform' };
    let preset = (String(parsed.preset || 'platform') || 'platform') as AgentRoutePreset;
    if (preset === 'economy') {
      preset = 'platform';
      try {
        localStorage.setItem(ROUTE_PREFS_KEY, JSON.stringify({ preset: 'platform' }));
      } catch {
        /* ignore */
      }
    }
    if (preset === 'platform') return { preset: 'platform' };
    if (preset === 'balanced' || preset === 'quality') {
      return resolvePresetForRegion(preset, rules);
    }
    if (preset === 'custom') {
      const migrated = migrateLegacyRouteKeys(parsed);
      return remapRetiredRoutePrefs({
        preset: 'custom',
        fast: migrated.fast,
        standard: migrated.standard,
        reasoning: migrated.reasoning,
        vision: migrated.vision,
        image: migrated.image,
      });
    }
    return { preset: 'platform' };
  } catch {
    return { preset: 'platform' };
  }
}

export function saveAgentRoutePrefs(prefs: AgentRoutePrefs) {
  try {
    localStorage.setItem(ROUTE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Payload for /design/run when chat model is Auto. null = follow platform. */
export function routeOverridesForApi(
  prefs: AgentRoutePrefs = loadAgentRoutePrefs()
): Record<string, string> | null {
  if (!prefs || prefs.preset === 'platform') return null;
  let base: AgentRoutePrefs =
    prefs.preset === 'economy' || prefs.preset === 'balanced' || prefs.preset === 'quality'
      ? resolvePresetForRegion(prefs.preset)
      : { ...prefs };
  if (cachedOpenrouterAvailable === false) {
    base = remapPrefsWithoutOpenRouter(base);
  }
  // When every lane fell back to domestic Standard, omit overrides (same as platform).
  if (prefs.preset === 'balanced' || prefs.preset === 'quality') {
    const platformish = resolveNamedPreset('economy');
    const sameAsDomestic = (['fast', 'standard', 'reasoning', 'vision', 'image'] as const).every(
      (k) => String(base[k] || '') === String(platformish[k] || '')
    );
    if (sameAsDomestic) return null;
  }
  const out: Record<string, string> = {};
  for (const key of ['fast', 'standard', 'reasoning', 'vision', 'image'] as const) {
    const v = String(base[key] || '').trim();
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Cache OpenRouter availability from GET /chat/models (region gate). */
export function warmOpenrouterAvailability(available: boolean | null | undefined) {
  if (available == null) return;
  cachedOpenrouterAvailable = Boolean(available);
}

export function getCachedOpenrouterAvailability(): boolean | null {
  return cachedOpenrouterAvailable;
}

export function cachePresetRules(rules: Record<string, string> | null) {
  cachedPresetRules = rules;
}

export function getCachedPresetRules(): Record<string, string> | null {
  return cachedPresetRules;
}

/** Design pipeline depth — not model thinking effort. */
export type DesignIntensity = 'light' | 'medium' | 'high' | 'extreme';

const DESIGN_INTENSITY_KEY = 'recombyn.designIntensity.v1';
export const DESIGN_INTENSITY_VALUES: DesignIntensity[] = [
  'light',
  'medium',
  'high',
  'extreme',
];

export function normalizeDesignIntensity(raw: unknown): DesignIntensity {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (s === 'light' || s === 'low' || s === '轻度' || s === '极速') return 'light';
  if (s === 'high' || s === '高') return 'high';
  if (s === 'extreme' || s === 'max' || s === '极高') return 'extreme';
  if (s === 'medium' || s === 'mid' || s === '中' || s === '标准') return 'medium';
  return 'medium';
}

export function loadDesignIntensity(): DesignIntensity {
  try {
    return normalizeDesignIntensity(localStorage.getItem(DESIGN_INTENSITY_KEY));
  } catch {
    return 'medium';
  }
}

export function saveDesignIntensity(value: DesignIntensity) {
  const next = normalizeDesignIntensity(value);
  try {
    localStorage.setItem(DESIGN_INTENSITY_KEY, next);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent('recombyn-design-intensity', { detail: next })
    );
  } catch {
    /* ignore */
  }
}

/** Warm Admin preset cache (call before send if panel not opened). */
export async function warmAgentRoutePresetRules(
  rules?: Record<string, string> | null
): Promise<void> {
  if (rules && typeof rules === 'object') {
    cachedPresetRules = rules;
  } else {
    try {
      const cat = await fetchDesignCatalog();
      cachedPresetRules = cat.global_rules || {};
    } catch {
      /* keep fallback */
    }
  }
  if (cachedOpenrouterAvailable == null) {
    try {
      const res = await listModels();
      warmOpenrouterAvailability(res?.openrouterAvailable);
    } catch {
      /* keep null */
    }
  }
}
