import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertPrivatePathSecurity,
  protectPrivatePath,
} from "../../security/privateFileSecurity.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MASTER_KEY_NAME = "master.key";

let cachedMasterKey: Buffer | null = null;
let cachedMasterKeyPath: string | null = null;

export function masterKeyPath(appDataDir: string): string {
  return join(appDataDir, MASTER_KEY_NAME);
}

export function resetProviderCredentialCache(): void {
  cachedMasterKey = null;
  cachedMasterKeyPath = null;
}

export async function getMasterKey(appDataDir: string): Promise<Buffer> {
  const keyPath = masterKeyPath(appDataDir);
  if (cachedMasterKey && cachedMasterKeyPath === keyPath) return cachedMasterKey;

  if (existsSync(keyPath)) {
    assertPrivatePathSecurity(keyPath);
    cachedMasterKey = await readFile(keyPath);
    cachedMasterKeyPath = keyPath;
    if (cachedMasterKey.length !== KEY_LENGTH) {
      throw new Error("generation master key has an unexpected length");
    }
    return cachedMasterKey;
  }

  const key = randomBytes(KEY_LENGTH);
  await writeFile(keyPath, key, { mode: 0o600, flag: "wx" });
  protectPrivatePath(keyPath, "file");
  cachedMasterKey = key;
  cachedMasterKeyPath = keyPath;
  return key;
}

export function encryptApiKey(apiKey: string, masterKey: Buffer): string {
  if (masterKey.length !== KEY_LENGTH) throw new Error("generation master key must be 32 bytes");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptApiKey(encrypted: string, masterKey: Buffer): string {
  if (masterKey.length !== KEY_LENGTH) throw new Error("generation master key must be 32 bytes");
  const packed = Buffer.from(encrypted, "base64");
  if (packed.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("encrypted API key is truncated");
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function apiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
