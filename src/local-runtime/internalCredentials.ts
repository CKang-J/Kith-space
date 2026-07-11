import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const DESKTOP_TOKEN_ENV = "KITH_SPACE_DESKTOP_TOKEN";
const WORKER_TOKEN_ENV = "KITH_SPACE_WORKER_TOKEN";
const CREDENTIAL_BYTES = 32;

export const WORKER_TOKEN_HEADER = "x-kith-worker-token";

export type InternalProcessCredentials = {
  desktopTrustToken: string;
  workerToken: string;
};

function requiredCredential(name: typeof DESKTOP_TOKEN_ENV | typeof WORKER_TOKEN_ENV): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[Kith-space] Required internal process credential ${name} is not set.\n` +
      "  Generate one with a cryptographically secure random source and inject it before starting the process.",
    );
  }
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** Generate fresh, independent credentials for one Desktop-managed process group. */
export function generateInternalProcessCredentials(): InternalProcessCredentials {
  return {
    desktopTrustToken: randomBytes(CREDENTIAL_BYTES).toString("base64url"),
    workerToken: randomBytes(CREDENTIAL_BYTES).toString("base64url"),
  };
}

/** Fail before the Core Service starts if either local process boundary is unprotected. */
export function assertInternalCredentialsConfigured(): void {
  requiredCredential(DESKTOP_TOKEN_ENV);
  requiredCredential(WORKER_TOKEN_ENV);
}

/** Desktop trust is deliberately accepted from one private header and nowhere else. */
export function isDesktopTrustedRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const supplied = req.headers["x-kith-desktop-token"];
  if (typeof supplied !== "string") return false;
  return constantTimeEqual(supplied, requiredCredential(DESKTOP_TOKEN_ENV));
}

/** Credential used exclusively by the installation-local Worker control plane. */
export function workerBootstrapToken(): string {
  return requiredCredential(WORKER_TOKEN_ENV);
}
