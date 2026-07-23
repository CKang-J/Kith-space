import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function resolveExecutable(command: string, sourcePath = process.env.PATH ?? ""): string | null {
  if (path.isAbsolute(command)) return verified(command);
  const suffixes = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of sourcePath.split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, process.platform === "win32" ? `${command}${suffix.toLowerCase()}` : command);
      const found = verified(candidate) ?? verified(process.platform === "win32" ? path.resolve(directory, `${command}${suffix.toUpperCase()}`) : candidate);
      if (found) return found;
    }
  }
  return null;
}

function verified(candidate: string): string | null {
  if (!existsSync(candidate)) return null;
  try { accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return path.resolve(candidate); }
  catch { return null; }
}
