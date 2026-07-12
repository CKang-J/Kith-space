import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import crossSpawn from "cross-spawn";
import { buildBundledCliCmdCommand, buildBundledCliCommand, ensureKithSpaceBin } from "./kithSpaceBin.js";

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
      + "chcp 65001 >nul\r\n"
      + 'set "ELECTRON_RUN_AS_NODE=1"\r\n'
      + '"C:\\Program Files\\Kith-space\\Kith-space.exe" "C:\\runtime\\agent-cli.mjs" %*\r\n'
      + "exit /b %ERRORLEVEL%\r\n",
  );
});

test("development Worker writes a Windows command wrapper", { skip: process.platform !== "win32" }, () => {
  const dir = ensureKithSpaceBin();
  const wrapper = `${dir}\\kith-space.cmd`;

  assert.equal(existsSync(wrapper), true, "expected the Windows kith-space.cmd wrapper");
  assert.equal(existsSync(`${dir}\\kith-space`), false, "Windows must not retain the POSIX wrapper");
  assert.match(readFileSync(wrapper, "utf8"), /tsx(?:\.cmd)?/i);
  const result = crossSpawn.sync("kith-space", ["--help"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  assert.equal(result.status, 0, result.stderr || "expected the generated wrapper to be executable by cmd.exe");
  assert.match(result.stdout, /Kith-space agent CLI/);
});
