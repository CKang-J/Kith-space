import net from "node:net";

export const PI_ADVISOR_MAX_INPUT_BYTES = 256 * 1024;
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_SYSTEM_INSTRUCTION_BYTES = 96 * 1024;
const MAX_TRANSCRIPT_BYTES = 96 * 1024;

export type PiAdvisorHelperInput = {
  schemaVersion: 1;
  backendId: string;
  modelId: string;
  apiKind: string;
  thinkingLevel: string;
  credential: { type: "api_key" | "oauth" | "none"; value: string | null; expires?: number };
  systemInstruction: string;
  transcript: string;
  canonicalOrigin: string;
  allowedEgress: string[];
  pinnedAddresses: string[];
};

function within(value: string, max: number): boolean { return Buffer.byteLength(value) <= max; }

export function validatePiAdvisorHelperInput(value: unknown, supportedBackends: ReadonlySet<string>): PiAdvisorHelperInput {
  if (!value || typeof value !== "object") throw new Error("provider_request_invalid");
  const input = value as Partial<PiAdvisorHelperInput>;
  if (input.schemaVersion !== 1 || typeof input.backendId !== "string" || !supportedBackends.has(input.backendId)
    || typeof input.modelId !== "string" || !input.modelId || input.modelId.length > 256
    || typeof input.apiKind !== "string" || input.apiKind.length > 128
    || typeof input.thinkingLevel !== "string" || input.thinkingLevel.length > 32
    || !input.credential || !["api_key", "oauth", "none"].includes(input.credential.type)
    || (input.credential.type === "none" ? input.credential.value !== null : typeof input.credential.value !== "string")
    || (typeof input.credential.value === "string" && !within(input.credential.value, MAX_CREDENTIAL_BYTES))
    || typeof input.systemInstruction !== "string" || !within(input.systemInstruction, MAX_SYSTEM_INSTRUCTION_BYTES)
    || typeof input.transcript !== "string" || !within(input.transcript, MAX_TRANSCRIPT_BYTES)
    || typeof input.canonicalOrigin !== "string" || input.canonicalOrigin.length > 2048
    || !Array.isArray(input.allowedEgress) || input.allowedEgress.length < 1 || input.allowedEgress.length > 16
    || input.allowedEgress.some((item) => typeof item !== "string" || item.length > 2048)
    || !Array.isArray(input.pinnedAddresses) || input.pinnedAddresses.length < 1 || input.pinnedAddresses.length > 64
    || input.pinnedAddresses.some((item) => typeof item !== "string" || net.isIP(item) === 0)) throw new Error("provider_request_invalid");
  return input as PiAdvisorHelperInput;
}
