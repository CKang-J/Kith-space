import assert from "node:assert/strict";
import test from "node:test";
import { spawnRuntimeProcess } from "./runtimeProcess.js";

test("runtime process boundary preserves UTF-8 split across stdout chunks", async () => {
  const fixture = `
const bytes = Buffer.from("中文测试", "utf8");
process.stdout.write(bytes.subarray(0, 1), () => {
  setTimeout(() => process.stdout.write(bytes.subarray(1), () => process.exit(0)), 20);
});
`;
  const child = spawnRuntimeProcess(process.execPath, ["-e", fixture], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk; });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  assert.equal(exitCode, 0);
  assert.equal(output, "中文测试");
});

test("runtime process boundary can preserve raw protocol bytes for strict decoders", async () => {
  const child = spawnRuntimeProcess(
    process.execPath,
    ["-e", `process.stdout.write(Buffer.from([0x7b, 0xff, 0x7d]));`],
    { stdio: ["ignore", "pipe", "pipe"] },
    { rawBytes: true },
  );
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk) => { chunks.push(chunk); });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x7b, 0xff, 0x7d]));
});
