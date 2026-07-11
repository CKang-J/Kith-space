import { getHumanProfile } from "../app-data/appDatabase.js";

export const HUMAN_HANDLE = "you";

export interface HumanIdentity {
  id: string;
  handle: typeof HUMAN_HANDLE;
  displayName: string;
  email: string | null;
  description: string | null;
}

/** The one app-local Human, expressed in collaboration-addressing terms. */
export function getHumanIdentity(): HumanIdentity | null {
  const profile = getHumanProfile();
  if (!profile) return null;
  return {
    id: profile.id,
    handle: HUMAN_HANDLE,
    displayName: profile.name,
    email: profile.email,
    description: profile.description,
  };
}

export function humanIdentityForId(id: string | null | undefined): HumanIdentity | null {
  const human = getHumanIdentity();
  return human && human.id === id ? human : null;
}

export function humanIdentityForHandle(handle: string | null | undefined): HumanIdentity | null {
  if (!handle) return null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  return normalized === HUMAN_HANDLE ? getHumanIdentity() : null;
}
