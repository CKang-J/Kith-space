import type { KithLlmModel } from "./arkModelCatalog";

export const DEFAULT_KITH_AUDIO_MODEL_ID = "or-gemini-3-1-flash-tts";

export const KITH_AUDIO_MODELS: KithLlmModel[] = [
  {
    id: DEFAULT_KITH_AUDIO_MODEL_ID,
    label: "Gemini 3.1 Flash TTS",
    provider: "openrouter",
    kind: "audio",
    description: "多语言语音合成，支持语气标签",
    iconKey: "gemini",
  },
  {
    id: "or-kokoro-82m",
    label: "Kokoro 82M",
    provider: "openrouter",
    kind: "audio",
    description: "轻量多语言 TTS",
    iconKey: "openrouter",
  },
  {
    id: "or-fish-audio-s2-pro",
    label: "Fish Audio S2 Pro",
    provider: "openrouter",
    kind: "audio",
    description: "表现力旁白与对话合成",
    iconKey: "fishaudio",
  },
];

export function kithAudioModels(): KithLlmModel[] {
  return KITH_AUDIO_MODELS;
}
