import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DoubaoImageProvider } from "./providers/doubaoImageProvider.js";
import { encodeArkUrlJobId } from "./arkClient.js";

describe("DoubaoImageProvider", () => {
  it("submits a synchronous Ark image request and stores the result URL", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/images/generations")) {
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/a.png" }] }), { status: 200 });
      }
      if (url === "https://cdn.example/a.png") {
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const provider = new DoubaoImageProvider("ark-key", "https://ark.example/api/v3");
      const jobId = await provider.submit({ prompt: "starry night sky over a quiet city" });
      assert.equal(jobId, encodeArkUrlJobId("https://cdn.example/a.png"));
      assert.equal((calls[0]?.body as { model?: string }).model, "doubao-seedream-4-0-250828");
      assert.equal((calls[0]?.body as { size?: string }).size, "2048x2048");
      const status = await provider.getStatus(jobId);
      assert.equal(status.status, "completed");
      const bytes = await provider.downloadResult(jobId);
      assert.equal(bytes[0], 137);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the requested Seedream model and smart K-label size", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/images/generations")) {
        calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/b.png" }] }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const provider = new DoubaoImageProvider("ark-key", "https://ark.example/api/v3");
      await provider.submit({
        prompt: "starry night sky over a quiet city",
        config: { model: "doubao-seedream-4-5-251128", aspectRatio: "smart", resolution: "4K" },
      });
      assert.equal((calls[0]?.body as { model?: string }).model, "doubao-seedream-4-5-251128");
      assert.equal((calls[0]?.body as { size?: string }).size, "4K");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends the reference image as an Ark data URL for image-to-image tools", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/images/generations")) {
        calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/c.png" }] }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const provider = new DoubaoImageProvider("ark-key", "https://ark.example/api/v3");
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      await provider.submit({
        prompt: "Upscale this image to 2K.",
        config: { resolution: "2K" },
        referenceImage: png,
      });
      const image = (calls[0]?.body as { image?: string }).image;
      assert.equal(image, `data:image/png;base64,${png.toString("base64")}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
