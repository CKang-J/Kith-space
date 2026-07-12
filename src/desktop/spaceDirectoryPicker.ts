import { stat } from "node:fs/promises";
import path from "node:path";

interface SpaceDirectoryDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface SpaceDirectoryPickerDependencies {
  showOpenDialog(): Promise<unknown>;
  isDirectory?(candidate: string): Promise<boolean>;
}

function isDialogResult(value: unknown): value is SpaceDirectoryDialogResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.canceled === "boolean"
    && Array.isArray(candidate.filePaths)
    && candidate.filePaths.every((entry) => typeof entry === "string");
}

export function parseSpaceDirectoryDialogResult(value: unknown): string | null {
  if (!isDialogResult(value)) throw new Error("Space directory dialog returned an invalid result");
  if (value.canceled) return null;
  if (value.filePaths.length !== 1) throw new Error("Choose exactly one Space directory");
  const selected = value.filePaths[0]!;
  if (!path.isAbsolute(selected)) throw new Error("Space directory must be an absolute path");
  return path.normalize(selected);
}

async function pathIsDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

export async function pickSpaceDirectory({
  showOpenDialog,
  isDirectory = pathIsDirectory,
}: SpaceDirectoryPickerDependencies): Promise<string | null> {
  const selected = parseSpaceDirectoryDialogResult(await showOpenDialog());
  if (selected === null) return null;
  if (!(await isDirectory(selected))) throw new Error("Selected Space path is not a directory");
  return selected;
}
