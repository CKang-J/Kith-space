import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { readUtf8Stdin } from "./readStdin.js";

test("CLI stdin preserves UTF-8 text split across stream chunks", async () => {
  const input = new PassThrough();
  const result = readUtf8Stdin(input);
  const bytes = Buffer.from("中文测试", "utf8");

  input.write(bytes.subarray(0, 1));
  input.end(bytes.subarray(1));

  assert.equal(await result, "中文测试");
});
