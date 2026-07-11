import test from "node:test";
import assert from "node:assert/strict";
import { coreLoopbackUrl, resolveCorePort } from "../src/server/localEndpoint.ts";

const policy = (port: number) => ({ getListenerPolicy: () => ({ port }) });

test("Core endpoint uses app.db listener settings when no development override is present", () => {
  assert.equal(resolveCorePort({}, policy(8123)), 8123);
  assert.equal(coreLoopbackUrl({}, policy(8123)), "http://127.0.0.1:8123");
});

test("the explicit development PORT override remains supported and validated", () => {
  assert.equal(resolveCorePort({ PORT: "9000" }, policy(8123)), 9000);
  for (const value of ["", "0", "65536", "abc", "7.5"]) {
    assert.throws(() => resolveCorePort({ PORT: value }, policy(8123)), /PORT must be an integer/);
  }
});
