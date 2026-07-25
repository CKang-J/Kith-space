import assert from "node:assert/strict";
import test from "node:test";
import { unsafePosixFileMetadata } from "./posixFileMetadata.js";

test("POSIX metadata policy ignores synthesized Windows mode bits", () => {
  assert.equal(unsafePosixFileMetadata({ mode: 0o666, uid: 0 }, 0o077, "win32", undefined), false);
});

test("POSIX metadata policy enforces owner and caller-specific mode masks", () => {
  assert.equal(unsafePosixFileMetadata({ mode: 0o600, uid: 1000 }, 0o077, "linux", 1000), false);
  assert.equal(unsafePosixFileMetadata({ mode: 0o644, uid: 1000 }, 0o077, "linux", 1000), true);
  assert.equal(unsafePosixFileMetadata({ mode: 0o755, uid: 1000 }, 0o022, "darwin", 1000), false);
  assert.equal(unsafePosixFileMetadata({ mode: 0o775, uid: 1000 }, 0o022, "darwin", 1000), true);
  assert.equal(unsafePosixFileMetadata({ mode: 0o600, uid: 1001 }, 0o077, "linux", 1000), true);
});
