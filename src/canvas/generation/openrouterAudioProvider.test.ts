import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { kithSpaceHome } from "../../paths.js";
import { OpenRouterAudioProvider, decodeOpenRouterBytesJobId } from "./providers/openrouterAudioProvider.js";

describe("OpenRouterAudioProvider", () => {
  it("posts OpenRouter speech and caches mp3 bytes", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    const mp3 = Buffer.from("ID3\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/audio/speech")) {
        return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const provider = new OpenRouterAudioProvider("or-key", "https://openrouter.example/api/v1");
      const jobId = await provider.submit({ prompt: "hello from the canvas" });
      assert.match(jobId, /^openrouter-bytes:/);
      assert.equal((calls[0]?.body as { model?: string }).model, "google/gemini-3.1-flash-tts-preview");
      assert.equal((calls[0]?.body as { voice?: string }).voice, "Zephyr");
      assert.equal((calls[0]?.body as { response_format?: string }).response_format, "mp3");
      const status = await provider.getStatus(jobId);
      assert.equal(status.status, "completed");
      const bytes = await provider.downloadResult(jobId);
      assert.equal(bytes.subarray(0, 3).toString("ascii"), "ID3");
      const cacheId = decodeOpenRouterBytesJobId(jobId);
      assert.ok(cacheId);
      assert.equal(existsSync(path.join(kithSpaceHome(), "generation-cache", `${cacheId}.mp3`)), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps catalog ids to OpenRouter slugs and omits Fish Audio voice", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/audio/speech")) {
        calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(Buffer.from("ID3"), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const provider = new OpenRouterAudioProvider("or-key", "https://openrouter.example/api/v1");
      await provider.submit({ prompt: "hello", config: { model: "or-kokoro-82m" } });
      assert.equal((calls[0]?.body as { model?: string }).model, "hexgrad/kokoro-82m");
      assert.equal((calls[0]?.body as { voice?: string }).voice, "af_bella");
      await provider.submit({ prompt: "hello", config: { model: "or-fish-audio-s2-pro" } });
      assert.equal((calls[1]?.body as { model?: string }).model, "fish-audio/s2.1-pro");
      assert.equal((calls[1]?.body as { voice?: string }).voice, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
