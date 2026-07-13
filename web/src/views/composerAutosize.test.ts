import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  autosizeComposerInput,
  observeComposerInputWidth,
} from "./composerAutosize.ts";

test("composer autosize recalculates when a zero-width Chat pane expands", () => {
  let resize: ResizeObserverCallback | undefined;
  let disconnected = false;
  const OriginalResizeObserver = globalThis.ResizeObserver;

  globalThis.ResizeObserver = class ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() { disconnected = true; }
  } as typeof ResizeObserver;

  try {
    const input = {
      clientWidth: 0,
      scrollHeight: 160,
      style: { height: "" },
    } as Pick<HTMLTextAreaElement, "clientWidth" | "scrollHeight" | "style">;

    autosizeComposerInput(input);
    assert.equal(input.style.height, "160px");

    const stop = observeComposerInputWidth(input);
    Object.assign(input, { clientWidth: 360, scrollHeight: 27 });
    resize?.([], {} as ResizeObserver);
    assert.equal(input.style.height, "27px");

    stop();
    assert.equal(disconnected, true);
  } finally {
    globalThis.ResizeObserver = OriginalResizeObserver;
  }
});

test("Composer wires width observation into its textarea lifecycle", () => {
  const source = readFileSync(new URL("./Composer.tsx", import.meta.url), "utf8");
  assert.match(source, /observeComposerInputWidth\(el\)/);
});
