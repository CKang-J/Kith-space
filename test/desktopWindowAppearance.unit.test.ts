import assert from "node:assert/strict";
import test from "node:test";
import { desktopWindowAppearance } from "../src/desktop/windowAppearance.ts";

test("macOS keeps an inset native drag boundary and traffic-light safe area", () => {
  assert.deepEqual(desktopWindowAppearance("darwin"), { titleBarStyle: "hiddenInset" });
});

test("Windows and Linux keep their platform title bars", () => {
  assert.deepEqual(desktopWindowAppearance("win32"), {});
  assert.deepEqual(desktopWindowAppearance("linux"), {});
});
