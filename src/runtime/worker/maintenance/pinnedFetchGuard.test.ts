import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { installPinnedFetchGuard } from "./pinnedFetchGuard.js";

test("pinned fetch uses the preflight address and rejects redirects before credentials can reach another origin", async () => {
  let redirectedHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `http://127.0.0.1:${(server.address() as any).port}/target` }); response.end(); return;
    }
    if (request.url === "/target") redirectedHits += 1;
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port as number;
  const origin = `http://provider.invalid:${port}`;
  const release = installPinnedFetchGuard({ allowedEgress: [origin], pinnedAddresses: ["127.0.0.1"] });
  try {
    assert.equal(await fetch(`${origin}/ok`).then((response) => response.text()), "ok");
    await assert.rejects(fetch(`${origin}/redirect`), /provider_postflight_destination_mismatch/);
    assert.equal(redirectedHits, 0);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/target`), /provider_postflight_destination_mismatch/);
  } finally {
    await release(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
