import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SeedreamVideoProvider } from "./providers/seedreamVideoProvider.js";

describe("SeedreamVideoProvider", () => {
  it("sends Seedance model, ratio, resolution, and clamped duration", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body: unknown }> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "task-1" }), { status: 200 });
    }) as typeof fetch;
    try {
      const provider = new SeedreamVideoProvider("ark-key", "https://ark.example/api/v3");
      const id = await provider.submit({
        prompt: "camera slowly pans across a neon cityscape",
        config: {
          model: "doubao-seedance-1-0-lite-t2v-250428",
          aspectRatio: "9:16",
          resolution: "1080p",
          duration: 15,
        },
      });
      assert.equal(id, "task-1");
      const body = calls[0]?.body as {
        model?: string;
        ratio?: string;
        resolution?: string;
        duration?: number;
      };
      assert.equal(body.model, "doubao-seedance-1-0-lite-t2v-250428");
      assert.equal(body.ratio, "9:16");
      assert.equal(body.resolution, "720p");
      assert.equal(body.duration, 12);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
