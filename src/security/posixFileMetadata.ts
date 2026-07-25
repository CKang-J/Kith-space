import type { Stats } from "node:fs";

type OwnershipAndMode = Pick<Stats, "mode" | "uid">;

/**
 * Applies owner and POSIX mode-bit checks only where Node exposes real POSIX metadata.
 * Windows reports synthesized mode bits; access control there is provided by NTFS ACLs.
 */
export function unsafePosixFileMetadata(
  stat: OwnershipAndMode,
  forbiddenModeMask: number,
  platform: NodeJS.Platform = process.platform,
  currentUid: number | undefined = typeof process.getuid === "function" ? process.getuid() : undefined,
): boolean {
  if (platform === "win32") return false;
  return (currentUid !== undefined && stat.uid !== currentUid) || (stat.mode & forbiddenModeMask) !== 0;
}
