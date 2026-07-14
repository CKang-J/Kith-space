// The one local Human owns the selected Space. Channel membership is an
// agent collaboration boundary and must not be used as a Human auth gate.
import { channelLifecycleState } from "../channels/channelLifecycle.js";

/** Archived history remains readable; deleted or missing containers do not. */
export async function canHumanReadChannel(spaceId: string, channelId: string): Promise<boolean> {
  const state = await channelLifecycleState(spaceId, channelId);
  return state === "active" || state === "archived";
}
