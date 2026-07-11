import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildDesktopProcessCommands } from "./processCommands.js";

test("packaged Desktop runs internal Core and Worker bundles without tsx or Vite", () => {
  const resourcesPath = path.resolve("C:/Program Files/Kith-space/resources");
  const appRoot = path.join(resourcesPath, "app.asar");
  const executable = path.resolve("C:/Program Files/Kith-space/Kith-space.exe");

  const commands = buildDesktopProcessCommands({
    mode: "packaged",
    appRoot,
    resourcesPath,
    executable,
    uiPort: 5273,
  });

  assert.deepEqual(commands.core.args, [path.join(resourcesPath, "runtime/core.cjs")]);
  assert.deepEqual(commands.worker.args, [path.join(resourcesPath, "runtime/worker.mjs")]);
  assert.equal(commands.core.command, executable);
  assert.equal(commands.worker.command, executable);
  assert.equal(commands.vite, undefined);
  assert.equal(commands.core.env?.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(commands.worker.env?.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(commands.worker.env?.NODE_PATH, undefined);
  assert.equal(commands.core.env?.KITH_SPACE_WEB_DIST, path.join(resourcesPath, "web/dist"));
  assert.equal(commands.core.env?.KITH_SPACE_MIGRATIONS_DIR, path.join(resourcesPath, "drizzle"));
  assert.equal(commands.core.env?.NODE_PATH, path.join(appRoot, "node_modules"));
});
