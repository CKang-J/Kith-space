import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_VERSION = "v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function deriveScrypt(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function encodeAccessToken(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveScrypt(secret, salt);
  return [
    "scrypt",
    SCRYPT_VERSION,
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyAccessToken(secret: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (
    parts.length !== 7
    || parts[0] !== "scrypt"
    || parts[1] !== SCRYPT_VERSION
    || parts[2] !== String(SCRYPT_COST)
    || parts[3] !== String(SCRYPT_BLOCK_SIZE)
    || parts[4] !== String(SCRYPT_PARALLELIZATION)
    || !parts[5]
    || !parts[6]
  ) return false;

  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await deriveScrypt(secret, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
