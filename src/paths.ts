// Single source of truth for on-disk locations. KITH_SPACE_HOME (default ~/.kith-space) relocates
// installation-level app data. KITH_SPACE_SPACES_DIR independently relocates default Space roots.
// Read on each call so env loaded by env.ts (before first use) is honored, and tests can toggle it.
import os from "node:os";
import path from "node:path";

export const kithSpaceHome = (): string => process.env.KITH_SPACE_HOME ?? path.join(os.homedir(), ".kith-space");
export const appDbFile = (): string => path.join(kithSpaceHome(), "app.db");
export const defaultSpacesDir = (): string => process.env.KITH_SPACE_SPACES_DIR
  ? path.resolve(process.env.KITH_SPACE_SPACES_DIR)
  : path.join(os.homedir(), "Kith-space");
export const defaultSpaceRoot = (slug: string): string => path.join(defaultSpacesDir(), slug);
export const workspaceDbFile = (rootPath: string): string => path.join(rootPath, ".kith", "workspace.db");
export const userMemoryDir = (): string => path.join(kithSpaceHome(), "memory");
export const spaceMemoryDir = (rootPath: string): string => path.join(rootPath, ".kith", "memory");
export const spaceUploadsDir = (rootPath: string): string => path.join(rootPath, ".kith", "uploads");
export const spaceAgentMemoryDir = (rootPath: string, agentId: string): string => path.join(rootPath, ".kith", "agents", agentId);
export const runtimeDir = (): string => path.join(kithSpaceHome(), "runtime");
export const agentRuntimeStateDir = (spaceId: string, agentId: string, root = runtimeDir()): string => path.join(root, spaceId, agentId);
export const managedRuntimesDir = (): string => path.join(kithSpaceHome(), "managed-runtimes");
export const binDir = (): string => path.join(kithSpaceHome(), "bin");
// Specific overrides keep precedence over the HOME-derived default.
export const logsDir = (): string => process.env.KITH_SPACE_LOG_DIR ?? path.join(kithSpaceHome(), "logs");
