/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/store/modules/auth.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { createSlice } from '@reduxjs/toolkit';
import { clearAllProjectDrafts } from '@recombyn-native/components/editor/projectDraftStore';
import { clearHomeAgentBoot } from '@recombyn-native/utils/homeAgentBoot';
import { getToken, setToken as persistToken } from '@recombyn-native/utils/token';

const STORAGE_KEY = 'recombyn-auth-v1';

/** Account-bound local keys cleared on logout (not device UI prefs like theme). */
const SESSION_STORAGE_KEYS = [
  'recombyn.agentRoutePrefs.v1',
  'recombyn.customLlmProviders.v1',
  'recombyn.notices.read.v1',
  'recombyn.agentPaintMode.v1',
  'recombyn.agentEngineMode.v1',
  'recombyn.agentCodingCli.v1',
  'recombyn.byok.deviceKey.v1',
  'recombyn:custom-project-thumbs',
  'recombyn-google-oauth-nonce-v1',
] as const;

const SESSION_KEY_PREFIXES = [
  'recombyn-liked-cases-v1:',
  'recombyn-editor-tour-v3',
] as const;

export type AuthUser = {
  email: string;
  name: string;
  provider: 'email' | 'google';
  avatar?: string | null;
  bio?: string | null;
  id?: string;
  role?: 'user' | 'admin' | string;
  hasPassword?: boolean;
};

function loadAuth(): { user: AuthUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null };
    const parsed = JSON.parse(raw);
    return { user: parsed?.user ?? null };
  } catch {
    return { user: null };
  }
}

function persist(user: AuthUser | null) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user }));
}

function removeStorageKeys(storage: Storage, keys: readonly string[]) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function removeStorageByPrefixes(storage: Storage, prefixes: readonly string[]) {
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p))) doomed.push(key);
    }
  } catch {
    return;
  }
  removeStorageKeys(storage, doomed);
}

/**
 * Clear account-bound caches after logout / 401.
 * Keeps device prefs (theme, dock widths, language).
 */
export function clearSessionCaches() {
  removeStorageKeys(localStorage, SESSION_STORAGE_KEYS);
  removeStorageByPrefixes(localStorage, SESSION_KEY_PREFIXES);
  clearHomeAgentBoot();
  try {
    sessionStorage.removeItem('recombyn-google-oauth-nonce-v1');
    sessionStorage.removeItem('recombyn.byok.deviceKey.v1');
  } catch {
    /* ignore */
  }
  void clearAllProjectDrafts();
}

const initialState = loadAuth();

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action) {
      state.user = action.payload;
      persist(state.user);
    },
    setSession(state, action) {
      const { user, token } = action.payload as { user: AuthUser; token?: string | null };
      // Never restore a user session without a live token (logout race safety).
      if (token === null || (token === undefined && !getToken())) {
        state.user = null;
        persist(null);
        if (token === null) persistToken(null);
        return;
      }
      state.user = user;
      persist(user);
      if (token !== undefined) persistToken(token);
    },
    logout(state) {
      state.user = null;
      persist(null);
      persistToken(null);
    },
  },
});

export const { setUser, setSession, logout } = authSlice.actions;
export default authSlice.reducer;
