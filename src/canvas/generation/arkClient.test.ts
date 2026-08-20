import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arkFetchJson } from "./arkClient.js";

describe("arkFetchJson", () => {
  it("fails instead of hanging when the Ark request exceeds the timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
      return new Response("late", { status: 200 });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => arkFetchJson("https://ark.example/api/v3/images/generations", {
          method: "POST",
          apiKey: "ark-key",
          timeoutMs: 20,
          body: "{}",
        }),
        /timed out/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
