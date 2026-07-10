// Workspace member role → capability mapping.
// Separate from agent scopes.ts: scopes = agent data-plane abilities; capabilities = a human's admin permissions in a given server.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export type Role = "owner" | "admin" | "member";
export type Capability =
  | "manageServer"       // server settings/rename/delete/agreement/avatar
  | "manageChannels"     // create/delete/archive channels
  | "manageAgents"       // create/delete agents
  | "manageMachines"     // manage machines/daemons
  | "manageMembers"      // invite/remove members (invites/join-links/remove)
  | "changeMemberRoles"  // change member roles
  | "manageBilling"      // billing/plan (owner only)
  | "joinPublicChannels";// join public channels (member's only capability)

const CAPS: Record<Role, Record<Capability, boolean>> = {
  owner:  { manageServer: true,  manageChannels: true,  manageAgents: true,  manageMachines: true,  manageMembers: true,  changeMemberRoles: true,  manageBilling: true,  joinPublicChannels: true },
  admin:  { manageServer: true,  manageChannels: true,  manageAgents: true,  manageMachines: true,  manageMembers: true,  changeMemberRoles: true,  manageBilling: false, joinPublicChannels: true },
  member: { manageServer: false, manageChannels: false, manageAgents: false, manageMachines: false, manageMembers: false, changeMemberRoles: false, manageBilling: false, joinPublicChannels: true },
};

export const ALL_CAPABILITIES = Object.keys(CAPS.owner) as Capability[];
/** Full capability boolean table for a role (for the frontend to show/hide UI by cap). Unknown role falls back to member. */
export const capabilitiesFor = (role: string | null | undefined): Record<Capability, boolean> => CAPS[(role as Role)] ?? CAPS.member;
/** Single check. Empty role → false. */
export const can = (role: string | null | undefined, cap: Capability): boolean => !!role && (CAPS[role as Role]?.[cap] ?? false);

/** Look up a user's role in a server (non-member = null). */
export async function memberRole(serverId: string, userId: string): Promise<Role | null> {
  const m = (await db.select().from(schema.serverMembers).where(and(eq(schema.serverMembers.serverId, serverId), eq(schema.serverMembers.userId, userId))))[0];
  return (m?.role as Role) ?? null;
}
/** Endpoint guard: whether the user has a capability in the server. */
export async function requireCap(serverId: string, userId: string, cap: Capability): Promise<boolean> {
  return can(await memberRole(serverId, userId), cap);
}
