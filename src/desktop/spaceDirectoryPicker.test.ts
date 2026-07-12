import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  parseSpaceDirectoryDialogResult,
  pickSpaceDirectory,
} from "./spaceDirectoryPicker.js";

const selectedDirectory = path.resolve("example-space");

test("Space directory selection returns null when the native dialog is cancelled", async () => {
  assert.equal(parseSpaceDirectoryDialogResult({ canceled: true, filePaths: [] }), null);
  assert.equal(await pickSpaceDirectory({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    isDirectory: async () => true,
  }), null);
});

test("Space directory selection returns one absolute directory", async () => {
  assert.equal(
    parseSpaceDirectoryDialogResult({ canceled: false, filePaths: [selectedDirectory] }),
    selectedDirectory,
  );
  assert.equal(await pickSpaceDirectory({
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedDirectory] }),
    isDirectory: async (candidate) => candidate === selectedDirectory,
  }), selectedDirectory);
});

test("Space directory selection rejects ambiguous or unsafe dialog results", async () => {
  assert.throws(() => parseSpaceDirectoryDialogResult({
    canceled: false,
    filePaths: [selectedDirectory, path.resolve("second-space")],
  }));
  assert.throws(() => parseSpaceDirectoryDialogResult({ canceled: false, filePaths: ["relative-space"] }));
  await assert.rejects(() => pickSpaceDirectory({
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedDirectory] }),
    isDirectory: async () => false,
  }));
});
