import { getHumanProfile, type HumanProfile } from "../app-data/appDatabase.js";

/** Resolve the authenticated transport subject to the one local Human. */
export function localHumanForSubject(subjectId: string | null): HumanProfile | null {
  if (!subjectId) return null;
  const human = getHumanProfile();
  return human?.id === subjectId ? human : null;
}
