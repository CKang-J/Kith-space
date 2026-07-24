import type { AdvisorApiKind } from "./contracts.js";

const ALLOWED = new Map<string, ReadonlySet<string>>([
  ["anthropic\0anthropic-messages", new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"])],
  ["openai\0openai-responses", new Set(["OPENAI_API_KEY"])],
  ["openai\0openai-completions", new Set(["OPENAI_API_KEY"])],
  ["openrouter\0openai-completions", new Set(["OPENROUTER_API_KEY"])],
  ["google\0google-generative-ai", new Set(["GEMINI_API_KEY", "GOOGLE_API_KEY"])],
  ["mistral\0mistral-conversations", new Set(["MISTRAL_API_KEY"])],
  ["deepseek\0openai-completions", new Set(["DEEPSEEK_API_KEY"])],
  ["azure-openai\0azure-openai-responses", new Set(["AZURE_OPENAI_API_KEY"])],
]);

export function advisorCredentialEnvAllowed(backendId: string, apiKind: string, envName: string): boolean {
  return ALLOWED.get(`${backendId}\0${apiKind as AdvisorApiKind}`)?.has(envName) === true;
}
