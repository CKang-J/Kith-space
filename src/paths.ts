// Single source of truth for on-disk locations. KITH_SPACE_HOME (default ~/.kith-space) lets each
// worktree/dev environment use its own data dir so parallel daemons/agents never collide.
// Read on each call so env loaded by env.ts (before first use) is honored, and tests can toggle it.
import os from "node:os";
import path from "node:path";

export const kithSpaceHome = (): string => process.env.KITH_SPACE_HOME ?? path.join(os.homedir(), ".kith-space");
export const registryDbFile = (): string => path.join(kithSpaceHome(), "registry.db");
export const defaultWorkspacesDir = (): string => process.env.KITH_SPACE_HOME
  ? path.join(kithSpaceHome(), "workspaces")
  : path.join(os.homedir(), "Kith-space");
export const defaultWorkspaceRoot = (slug: string): string => path.join(defaultWorkspacesDir(), slug);
export const workspaceDbFile = (rootPath: string): string => path.join(rootPath, ".kith", "workspace.db");
export const userMemoryDir = (): string => path.join(kithSpaceHome(), "memory");
export const workspaceMemoryDir = (rootPath: string): string => path.join(rootPath, ".kith", "memory");
export const agentsDir = (): string => path.join(kithSpaceHome(), "agents");
export const binDir = (): string => path.join(kithSpaceHome(), "bin");
export const machineIdFile = (): string => path.join(kithSpaceHome(), "machine-id");
// Specific overrides keep precedence over the HOME-derived default.
export const logsDir = (): string => process.env.KITH_SPACE_LOG_DIR ?? path.join(kithSpaceHome(), "logs");
export const uploadsDir = (): string => process.env.KITH_SPACE_UPLOAD_DIR ?? path.join(kithSpaceHome(), "uploads");
