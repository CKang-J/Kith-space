import type { KithDesktopBridge } from "./desktopBridge.ts";

export interface PersonalSetupHuman {
  id: string;
  name: string;
  email?: string | null;
  description?: string | null;
}

export interface PersonalSetupHome {
  id: string;
  name: string;
  slug: string;
}

export interface PersonalSetupStatus {
  initialized: boolean;
  human?: PersonalSetupHuman | null;
  home?: PersonalSetupHome | null;
}

export interface PersonalSetupInput {
  name: string;
  email?: string;
  description?: string;
}

export interface PersonalSetupDraft {
  name: string;
  email: string;
  description: string;
}

export type PersonalSetupField = keyof PersonalSetupDraft;
export interface PersonalSetupFieldErrors {
  name?: "required" | "tooLong";
  email?: "invalid";
  description?: "tooLong";
}

export interface PersonalSetupValidation {
  input: PersonalSetupInput | null;
  errors: PersonalSetupFieldErrors;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ErrorBody = { error?: string; message?: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const MAX_DESCRIPTION_LENGTH = 3000;

export function desktopRequiresPersonalSetupCheck(bridge: KithDesktopBridge | null): boolean {
  return bridge !== null;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function requestFailureMessage(response: Response, body: unknown): string {
  const error = body as ErrorBody;
  const serverMessage = error?.message || error?.error;
  return serverMessage || `First-run setup failed (${response.status})`;
}

function parseStatus(value: unknown): PersonalSetupStatus {
  if (typeof value !== "object" || value === null) {
    throw new Error("First-run setup response is invalid");
  }
  const status = value as Record<string, unknown>;
  if (typeof status.initialized !== "boolean") throw new Error("First-run setup response is invalid");
  if (!status.initialized) return value as PersonalSetupStatus;

  const human = status.human as Record<string, unknown> | null;
  const home = status.home as Record<string, unknown> | null;
  if (
    !human || typeof human.id !== "string" || typeof human.name !== "string"
    || !home || typeof home.id !== "string" || typeof home.name !== "string" || typeof home.slug !== "string"
  ) {
    throw new Error("First-run setup response is invalid");
  }
  return value as PersonalSetupStatus;
}

async function requestSetup(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<PersonalSetupStatus> {
  const response = await fetcher(url, { credentials: "same-origin", ...init });
  const body = await readJson(response);
  if (!response.ok) throw new Error(requestFailureMessage(response, body));
  return parseStatus(body);
}

export function validatePersonalSetup(draft: PersonalSetupDraft): PersonalSetupValidation {
  const name = draft.name.trim();
  const email = draft.email.trim();
  const description = draft.description.trim();
  const errors: PersonalSetupFieldErrors = {};

  if (!name) errors.name = "required";
  else if (name.length > MAX_NAME_LENGTH) errors.name = "tooLong";
  if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))) errors.email = "invalid";
  if (description.length > MAX_DESCRIPTION_LENGTH) errors.description = "tooLong";

  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      name,
      ...(email ? { email } : {}),
      ...(description ? { description } : {}),
    },
    errors,
  };
}

export function loadPersonalSetupStatus(fetcher: Fetcher = fetch): Promise<PersonalSetupStatus> {
  return requestSetup("/api/setup/status", { method: "GET" }, fetcher);
}

export async function initializePersonalSetup(
  input: PersonalSetupInput,
  fetcher: Fetcher = fetch,
): Promise<PersonalSetupStatus> {
  const status = await requestSetup("/api/setup/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }, fetcher);
  if (!status.initialized) throw new Error("First-run setup did not complete");
  return status;
}
