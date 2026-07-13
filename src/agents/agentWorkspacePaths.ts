import path from "node:path";
import { agentRuntimeStateDir, runtimeDir, spaceAgentMemoryDir } from "../paths.js";

export interface AgentWorkspaceRef {
  agentId: string;
  spaceId: string;
  workspaceRoot: string;
}

export interface AgentWorkspacePaths {
  workspaceRoot: string;
  agentMemoryDir: string;
  runtimeStateDir: string;
}

function assertSafePathSegment(label: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be a safe path segment`);
  }
}

function assertOwnedChild(label: string, parent: string, candidate: string): void {
  const relative = path.relative(parent, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its owned container`);
  }
}

/** Resolve one Agent's Space-local memory directory for Human-facing memory tools. */
export function resolveAgentMemoryDir(workspaceRoot: string, agentId: string): string {
  if (!workspaceRoot.trim() || !agentId.trim()) {
    throw new Error("Agent Memory directory requires workspaceRoot and agentId");
  }
  assertSafePathSegment("agentId", agentId);
  const agentMemoryRoot = path.resolve(workspaceRoot, ".kith", "agents");
  const agentMemoryDir = path.resolve(spaceAgentMemoryDir(workspaceRoot, agentId));
  assertOwnedChild("agentMemoryDir", agentMemoryRoot, agentMemoryDir);
  return agentMemoryDir;
}

/** Resolve the three paths with deliberately different ownership and lifecycles. */
export function resolveAgentWorkspacePaths(
  ref: AgentWorkspaceRef,
  runtimeStateRoot = runtimeDir(),
): AgentWorkspacePaths {
  if (!ref.agentId.trim() || !ref.spaceId.trim() || !ref.workspaceRoot.trim()) {
    throw new Error("agent workspace reference requires agentId, spaceId, and workspaceRoot");
  }
  assertSafePathSegment("agentId", ref.agentId);
  assertSafePathSegment("spaceId", ref.spaceId);
  const workspaceRoot = path.resolve(ref.workspaceRoot);
  const runtimeRoot = path.resolve(runtimeStateRoot);
  const agentMemoryDir = resolveAgentMemoryDir(workspaceRoot, ref.agentId);
  const runtimeStateDir = path.resolve(agentRuntimeStateDir(ref.spaceId, ref.agentId, runtimeRoot));
  assertOwnedChild("runtimeStateDir", runtimeRoot, runtimeStateDir);
  return {
    workspaceRoot,
    agentMemoryDir,
    runtimeStateDir,
  };
}
