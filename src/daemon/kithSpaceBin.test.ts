import assert from "node:assert/strict";
import test from "node:test";
import { buildBundledCliCmdCommand, buildBundledCliCommand } from "./kithSpaceBin.js";

test("packaged Worker wrapper reuses the Electron executable in Node mode", () => {
  assert.equal(
    buildBundledCliCommand("C:/Program Files/Kith-space/Kith-space.exe", "C:/runtime/agent-cli.mjs", true),
    'exec env ELECTRON_RUN_AS_NODE=1 "C:/Program Files/Kith-space/Kith-space.exe" "C:/runtime/agent-cli.mjs" "$@"',
  );
});

test("standalone Node bundles do not set Electron process flags", () => {
  assert.equal(
    buildBundledCliCommand("/usr/bin/node", "/opt/kith/agent-cli.mjs", false),
    'exec "/usr/bin/node" "/opt/kith/agent-cli.mjs" "$@"',
  );
});

test("packaged Worker writes a Windows command wrapper with scoped Electron Node mode", () => {
  assert.equal(
    buildBundledCliCmdCommand("C:\\Program Files\\Kith-space\\Kith-space.exe", "C:\\runtime\\agent-cli.mjs", true),
    "@echo off\r\n"
      + "setlocal\r\n"
      + 'set "ELECTRON_RUN_AS_NODE=1"\r\n'
      + '"C:\\Program Files\\Kith-space\\Kith-space.exe" "C:\\runtime\\agent-cli.mjs" %*\r\n'
      + "exit /b %ERRORLEVEL%\r\n",
  );
});
