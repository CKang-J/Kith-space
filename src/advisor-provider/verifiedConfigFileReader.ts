import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { unsafePosixFileMetadata } from "../security/posixFileMetadata.js";

export interface VerifiedConfigFile {
  path: string;
  buffer: Buffer;
  identity: string;
  contentDigest: string;
}

export class VerifiedConfigFileReader {
  constructor(private readonly maxBytes = 1024 * 1024) {}

  read(root: string, filename: string, optional = false): VerifiedConfigFile | null {
    const canonicalRoot = realpathSync(root);
    const rootStat = lstatSync(canonicalRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("config_file_untrusted: invalid root");
    const target = path.resolve(canonicalRoot, filename);
    if (path.dirname(target) !== canonicalRoot) throw new Error("config_file_untrusted: path escapes root");
    let pathStat;
    try { pathStat = lstatSync(target); } catch (error: any) {
      if (optional && error?.code === "ENOENT") return null;
      throw error;
    }
    if (pathStat.isSymbolicLink()) throw new Error("config_file_untrusted: symlink rejected");
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const fd = openSync(target, constants.O_RDONLY | noFollow);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > this.maxBytes || unsafePosixFileMetadata(before, 0o022)) {
        throw new Error("config_file_untrusted: type, size, or permissions");
      }
      const buffer = readFileSync(fd);
      const after = fstatSync(fd);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || buffer.length !== after.size) {
        throw new Error("config_file_changed");
      }
      return {
        path: target,
        buffer,
        identity: `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}`,
        contentDigest: createHash("sha256").update(buffer).digest("hex"),
      };
    } finally { closeSync(fd); }
  }
}
