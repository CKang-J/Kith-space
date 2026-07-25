import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertPrivatePathSecurity,
  protectPrivatePath,
  windowsAclAllowsOnlyOwner,
} from "./privateFileSecurity.js";

test("Windows private ACL accepts only the current owner SID", () => {
  const owner = "S-1-5-21-1000";
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: owner, allowSids: [owner] }, owner), true);
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: owner, allowSids: [owner, "S-1-5-18"] }, owner), false);
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: owner, allowSids: [owner, "S-1-1-0"] }, owner), false);
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: owner, allowSids: [owner, "S-1-5-11"] }, owner), false);
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: "S-1-5-18", allowSids: [owner] }, owner), false);
  assert.equal(windowsAclAllowsOnlyOwner({ ownerSid: owner, allowSids: [] }, owner), false);
});

test("Windows private ACL hardening removes an explicit external grant", {
  skip: process.platform !== "win32",
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-private-acl-"));
  const target = path.join(root, "credential.json");
  try {
    writeFileSync(target, "{}");
    const grant = spawnSync("icacls.exe", [target, "/grant", "*S-1-5-11:(R)"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(grant.status, 0, grant.stderr);
    protectPrivatePath(target, "file");
    assert.doesNotThrow(() => assertPrivatePathSecurity(target));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private path hardening rejects symbolic links", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-private-link-"));
  const target = path.join(root, "credential.json");
  const link = path.join(root, "credential-link.json");
  try {
    writeFileSync(target, "{}");
    symlinkSync(target, link);
    assert.throws(() => protectPrivatePath(link, "file"), /symbolic link or junction/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
