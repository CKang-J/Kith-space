import { chmodSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { unsafePosixFileMetadata } from "./posixFileMetadata.js";

export type WindowsAclSummary = Readonly<{
  ownerSid: string;
  allowSids: readonly string[];
}>;

let cachedWindowsSid: string | null = null;
const verifiedWindowsCtimes = new Map<string, number>();

function currentWindowsSid(): string {
  if (cachedWindowsSid) return cachedWindowsSid;
  const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("unable to resolve the current Windows identity");
  const match = String(result.stdout).trim().match(/^"(?:[^"]|"")*","([^"]+)"$/);
  if (!match?.[1]) throw new Error("unable to parse the current Windows identity");
  cachedWindowsSid = match[1];
  return cachedWindowsSid;
}

function inspectWindowsAcl(target: string): WindowsAclSummary {
  const script = [
    "$acl = Get-Acl -LiteralPath $env:KITH_PRIVATE_PATH",
    "$sidType = [System.Security.Principal.SecurityIdentifier]",
    "$acl.GetOwner($sidType).Value",
    "$acl.Access | Where-Object { $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow } | ForEach-Object { $_.IdentityReference.Translate($sidType).Value }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, KITH_PRIVATE_PATH: target },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("unable to inspect the Windows ACL");
  const [ownerSid = "", ...allowSids] = String(result.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { ownerSid, allowSids };
}

export function windowsAclAllowsOnlyOwner(summary: WindowsAclSummary, expectedOwnerSid: string): boolean {
  return summary.ownerSid === expectedOwnerSid
    && summary.allowSids.length > 0
    && summary.allowSids.every((sid) => sid === expectedOwnerSid);
}

function replaceWindowsPrivateAcl(target: string, kind: "file" | "directory", ownerSid: string): void {
  const aclType = kind === "directory"
    ? "[System.Security.AccessControl.DirectorySecurity]::new()"
    : "[System.Security.AccessControl.FileSecurity]::new()";
  const inheritance = kind === "directory"
    ? "([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit)"
    : "[System.Security.AccessControl.InheritanceFlags]::None";
  const script = [
    "$sid = [System.Security.Principal.SecurityIdentifier]::new($env:KITH_PRIVATE_OWNER_SID)",
    `$acl = ${aclType}`,
    "$acl.SetOwner($sid)",
    "$acl.SetAccessRuleProtection($true, $false)",
    `$inheritance = ${inheritance}`,
    "$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)",
    "[void]$acl.AddAccessRule($rule)",
    "Set-Acl -LiteralPath $env:KITH_PRIVATE_PATH -AclObject $acl",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      KITH_PRIVATE_OWNER_SID: ownerSid,
      KITH_PRIVATE_PATH: target,
    },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("unable to replace the Windows private path ACL");
}

export function assertPrivatePathSecurity(target: string): void {
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink()) throw new Error("private path cannot be a symbolic link or junction");
  if (process.platform === "win32") {
    const ctimeMs = metadata.ctimeMs;
    if (verifiedWindowsCtimes.get(target) === ctimeMs) return;
    const ownerSid = currentWindowsSid();
    if (!windowsAclAllowsOnlyOwner(inspectWindowsAcl(target), ownerSid)) {
      throw new Error("private path ACL grants access outside the current Windows identity");
    }
    verifiedWindowsCtimes.set(target, ctimeMs);
    return;
  }
  if (unsafePosixFileMetadata(metadata, 0o077)) {
    throw new Error("private path owner or mode is unsafe");
  }
}

export function protectPrivatePath(target: string, kind: "file" | "directory"): void {
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink()) throw new Error("private path cannot be a symbolic link or junction");
  if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
    throw new Error(`private path is not a ${kind}`);
  }
  if (process.platform !== "win32") {
    chmodSync(target, kind === "directory" ? 0o700 : 0o600);
    assertPrivatePathSecurity(target);
    return;
  }
  const ownerSid = currentWindowsSid();
  const ctimeMs = metadata.ctimeMs;
  if (verifiedWindowsCtimes.get(target) === ctimeMs) return;
  replaceWindowsPrivateAcl(target, kind, ownerSid);
  verifiedWindowsCtimes.delete(target);
  assertPrivatePathSecurity(target);
}
