import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KITH_AUDIO_MODEL_ID, kithAudioModels } from "./openrouterAudioCatalog.ts";

test("Kith audio catalog matches Recombyn OpenRouter TTS ids", () => {
  const ids = kithAudioModels().map((model) => model.id);
  assert.deepEqual(ids, [
    DEFAULT_KITH_AUDIO_MODEL_ID,
    "or-kokoro-82m",
    "or-fish-audio-s2-pro",
  ]);
  assert.ok(kithAudioModels().every((model) => model.kind === "audio" && model.provider === "openrouter"));
  assert.deepEqual(
    kithAudioModels().map((model) => model.iconKey),
    ["gemini", "openrouter", "fishaudio"],
  );
});
