import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { isPortAvailable } from "./portAvailability.js";

test("Desktop port preflight rejects an occupied listener and accepts it after release", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  try {
    assert.equal(await isPortAvailable(port, "127.0.0.1"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal(await isPortAvailable(port, "127.0.0.1"), true);
});
