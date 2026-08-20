/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/homeAgentBoot.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { ComposerContext } from '@recombyn-native/components/editor/panels/AgentComposerInput';

const KEY = 'recombyn-home-agent-boot';

export type HomeAgentBoot = {
  /** May be empty when only skill / context chips are handed off. */
  prompt: string;
  autoSubmit: boolean;
  modelId?: string | null;
  /** Home Agent / Ask / Image switch. */
  interactionMode?: 'agent' | 'ask' | 'image' | 'video' | null;
  imageAspectRatio?: string | null;
  scene?: 'website' | 'mobile' | 'image' | 'poster' | 'drawing' | 'video' | null;
  stylePackId?: number | null;
  templateId?: number | null;
  promptPatternId?: number | null;
  /** Inline composer chips (e.g. plaza 「做同款」 skill pill). */
  contexts?: ComposerContext[];
  attachments?: Array<{
    key: string;
    label: string;
    kind: 'attachment';
    /** Vision / create_image ref (https upload URL or data URL). */
    dataUrl?: string;
    /** Local preview for thumbnails when dataUrl is a remote URL. */
    thumbUrl?: string;
    /** Object key from POST /api/v1/uploads. */
    uploadKey?: string;
  }>;
};

function bootHasPayload(boot: HomeAgentBoot | null | undefined): boolean {
  if (!boot) return false;
  if (typeof boot.prompt === 'string' && boot.prompt.trim()) return true;
  if (Array.isArray(boot.contexts) && boot.contexts.length > 0) return true;
  if (Array.isArray(boot.attachments) && boot.attachments.length > 0) return true;
  return false;
}

function writeBoot(storage: Storage, boot: HomeAgentBoot) {
  storage.setItem(KEY, JSON.stringify(boot));
}

/** Same-tab handoff (sessionStorage — not shared across tabs). */
export function saveHomeAgentBoot(boot: HomeAgentBoot) {
  try {
    writeBoot(sessionStorage, boot);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Seed boot into another same-origin tab's sessionStorage.
 * Used when opening editor in a new window — URL only carries flags (createNew / fromHomeAgent),
 * never the prompt text. Caller should open about:blank, seed, then navigate.
 */
export function seedHomeAgentBootOnWindow(win: Window, boot: HomeAgentBoot) {
  try {
    writeBoot(win.sessionStorage, boot);
  } catch {
    /* blocked / private mode */
  }
}

/**
 * Open editor in a new tab and hand off boot via that tab's sessionStorage.
 * URL keeps only markers (`createNew`, `fromHomeAgent`); payload is not in the URL / localStorage.
 * Returns null if the popup was blocked (caller should same-tab navigate).
 */
export function openEditorWindowWithBoot(dest: string, boot: HomeAgentBoot): Window | null {
  // Same-tab fallback if popup blocked / desktop shell.
  saveHomeAgentBoot(boot);
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  if (w.__TAURI_INTERNALS__ || w.__TAURI__ || import.meta.env.TAURI_ENV_PLATFORM) {
    return null;
  }
  const abs = new URL(dest, window.location.href).href;
  const win = window.open('about:blank', '_blank');
  if (!win) return null;
  seedHomeAgentBootOnWindow(win, boot);
  win.location.replace(abs);
  return win;
}

/** Read without removing — survives /editor → /editor/:id remount races. */
export function peekHomeAgentBoot(): HomeAgentBoot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeAgentBoot;
    if (!bootHasPayload(parsed)) return null;
    if (typeof parsed.prompt !== 'string') parsed.prompt = '';
    return parsed;
  } catch {
    return null;
  }
}

export function clearHomeAgentBoot() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function attachmentsFromBoot(boot: HomeAgentBoot | null): ComposerContext[] {
  if (!boot?.attachments?.length) return [];
  return boot.attachments
    .filter((a) => a?.dataUrl || a?.thumbUrl)
    .map((a) => ({
      key: a.key,
      label: a.label,
      kind: 'attachment',
      payload: a.label,
      dataUrl: a.dataUrl || a.thumbUrl,
      thumbUrl: a.thumbUrl,
      uploadKey: a.uploadKey,
    }));
}

export function contextsFromBoot(boot: HomeAgentBoot | null): ComposerContext[] {
  if (!boot?.contexts?.length) return [];
  return boot.contexts
    .filter((c) => c && typeof c.key === 'string' && c.key.trim())
    .map((c) => ({
      key: String(c.key),
      label: String(c.label || '').trim() || 'Skill',
      kind: String(c.kind || 'plaza'),
      payload: String(c.payload || ''),
      ...(c.dataUrl ? { dataUrl: String(c.dataUrl) } : {}),
      ...(c.thumbUrl ? { thumbUrl: String(c.thumbUrl) } : {}),
      ...(c.uploadKey ? { uploadKey: String(c.uploadKey) } : {}),
    }));
}
