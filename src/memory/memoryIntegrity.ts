import { createHmac } from "node:crypto";
import { getContentHmacKey } from "../app-data/appDatabase.js";
import { projectLexicalText } from "./lexicalProjection.js";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function memoryHmac(value: unknown): string {
  return createHmac("sha256", getContentHmacKey()).update(canonicalJson(value)).digest("hex");
}

export function claimHmac(input: {
  scope: string;
  ownerAgentId: string | null;
  subjectKey: string;
  predicateKey: string;
  canonicalText?: string;
}): string {
  return memoryHmac({
    scope: input.scope,
    ownerAgentId: input.ownerAgentId,
    subjectKey: projectLexicalText(input.subjectKey).normalizedText,
    predicateKey: projectLexicalText(input.predicateKey).normalizedText,
  });
}
