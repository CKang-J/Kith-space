import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type HostDirectoryEntry = { name: string; path: string };
export type HostDirectoryListing = {
  path: string;
  parentPath: string | null;
  roots: string[];
  entries: HostDirectoryEntry[];
};

export class HostDirectoryBrowserError extends Error {
  constructor(
    public readonly code: "HOST_PATH_INVALID" | "HOST_PATH_NOT_FOUND" | "HOST_PATH_NOT_DIRECTORY" | "HOST_PATH_UNREADABLE",
    message: string,
  ) {
    super(message);
    this.name = "HostDirectoryBrowserError";
  }
}

async function availableRoots(): Promise<string[]> {
  if (process.platform !== "win32") return [path.parse(os.homedir()).root || "/"];
  const candidates = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
  const checks = await Promise.all(candidates.map(async (candidate) => {
    try {
      const info = await fs.stat(candidate);
      return info.isDirectory() ? candidate : null;
    } catch {
      return null;
    }
  }));
  return checks.filter((candidate): candidate is string => candidate !== null);
}

async function isBrowsableDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

export async function listHostDirectories(requestedPath?: unknown): Promise<HostDirectoryListing> {
  const input = requestedPath === undefined || requestedPath === "" ? os.homedir() : requestedPath;
  if (typeof input !== "string" || !path.isAbsolute(input)) {
    throw new HostDirectoryBrowserError("HOST_PATH_INVALID", "Host directory path must be absolute");
  }

  const currentPath = path.resolve(input);
  let info;
  try {
    info = await fs.stat(currentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HostDirectoryBrowserError("HOST_PATH_NOT_FOUND", "Host directory does not exist");
    }
    throw new HostDirectoryBrowserError("HOST_PATH_UNREADABLE", "Host directory cannot be opened");
  }
  if (!info.isDirectory()) {
    throw new HostDirectoryBrowserError("HOST_PATH_NOT_DIRECTORY", "Host path is not a directory");
  }

  let children;
  try {
    children = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    throw new HostDirectoryBrowserError("HOST_PATH_UNREADABLE", "Host directory cannot be opened");
  }

  const candidates = children
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: path.join(currentPath, entry.name) }));
  const visible = await Promise.all(candidates.map(async (entry) => (
    await isBrowsableDirectory(entry.path) ? entry : null
  )));
  const entries = visible
    .filter((entry): entry is HostDirectoryEntry => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const parent = path.dirname(currentPath);

  return {
    path: currentPath,
    parentPath: parent === currentPath ? null : parent,
    roots: await availableRoots(),
    entries,
  };
}
