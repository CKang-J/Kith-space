export const DEFAULT_OPENROUTER_AUDIO_MODEL_ID = "or-gemini-3-1-flash-tts";
export const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";

export interface OpenRouterAudioModel {
  id: string;
  apiModel: string;
  label: string;
  description: string;
  voice?: string;
}

/** Recombyn catalog ids → OpenRouter `/audio/speech` slugs and default voices. */
export const OPENROUTER_AUDIO_MODELS: readonly OpenRouterAudioModel[] = [
  {
    id: DEFAULT_OPENROUTER_AUDIO_MODEL_ID,
    apiModel: "google/gemini-3.1-flash-tts-preview",
    label: "Gemini 3.1 Flash TTS",
    description: "多语言语音合成，支持语气标签",
    voice: "Zephyr",
  },
  {
    id: "or-kokoro-82m",
    apiModel: "hexgrad/kokoro-82m",
    label: "Kokoro 82M",
    description: "轻量多语言 TTS",
    voice: "af_bella",
  },
  {
    id: "or-fish-audio-s2-pro",
    apiModel: "fish-audio/s2.1-pro",
    label: "Fish Audio S2 Pro",
    description: "表现力旁白与对话合成",
  },
];

export function isKnownOpenRouterAudioModelId(id: string): boolean {
  const raw = id.trim();
  return OPENROUTER_AUDIO_MODELS.some((model) => model.id === raw || model.apiModel === raw);
}

export function resolveOpenRouterAudioModel(id?: string): OpenRouterAudioModel {
  const raw = id?.trim();
  return OPENROUTER_AUDIO_MODELS.find((model) => model.id === raw || model.apiModel === raw)
    ?? OPENROUTER_AUDIO_MODELS[0]!;
}
