import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { userMemoryDir, workspaceMemoryDir } from "../paths.js";

export interface MemoryLayerPath {
  root: string;
  indexFile: string;
  notesDir: string;
}

export interface MemoryLayerPaths {
  user: MemoryLayerPath;
  space: MemoryLayerPath;
  agent: MemoryLayerPath;
}

function layer(root: string): MemoryLayerPath {
  return {
    root,
    indexFile: path.join(root, "MEMORY.md"),
    notesDir: path.join(root, "notes"),
  };
}

/** Resolve all memory locations from KITH_SPACE_HOME, the workspace root, and the agent workspace. */
export function resolveMemoryLayerPaths(workspaceRoot: string, agentWorkspace: string): MemoryLayerPaths {
  return {
    user: layer(userMemoryDir()),
    space: layer(workspaceMemoryDir(workspaceRoot)),
    agent: layer(agentWorkspace),
  };
}

function sharedMemorySeed(title: string, purpose: string): string {
  return `# ${title}\n\n${purpose}\n\n## Index\n- None yet\n`;
}

async function ensureSharedLayer(target: MemoryLayerPath, title: string, purpose: string): Promise<void> {
  await mkdir(target.notesDir, { recursive: true });
  try {
    await writeFile(target.indexFile, sharedMemorySeed(title, purpose), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** Seed user/space indexes once. Agents subsequently read and edit them with runtime-native file tools. */
export async function ensureSharedMemoryLayers(paths: MemoryLayerPaths): Promise<void> {
  await Promise.all([
    ensureSharedLayer(paths.user, "User Memory", "Cross-workspace preferences and durable user context, curated by the user."),
    ensureSharedLayer(paths.space, "Space Memory", "Shared rules, background, and durable knowledge for this workspace."),
  ]);
}
