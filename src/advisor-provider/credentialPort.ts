import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getContentHmacKey } from "../app-data/appDatabase.js";
import { kithSpaceHome } from "../paths.js";
import { unsafePosixFileMetadata } from "../security/posixFileMetadata.js";
import { protectPrivatePath } from "../security/privateFileSecurity.js";
import { AdvisorProviderError, type AdvisorCredentialSourceKind } from "./contracts.js";
import { PiCliConfigImporter } from "./piCliConfigImporter.js";
import { advisorCredentialEnvAllowed } from "./credentialEnvPolicy.js";

type StoredSecret = { kind?: "kith_secret" | "pi_cli_source"; backendId: string; iv: string; tag: string; ciphertext: string };
type SecretFile = { schemaVersion: 1; entries: Record<string, StoredSecret> };
type Activation = {
  audience: "advisor" | "chat_runtime";
  source: AdvisorCredentialSourceKind;
  ref: string | null;
  runId: string;
  providerEpoch: number;
  workerGeneration: number;
  executionSnapshotDigest: string;
  expiresAt: number;
  backendId: string;
  apiKind: string;
  expectedCredentialIdentityDigest: string;
};

export type RedeemedProviderCredential = (
  | { value: string; type: "api_key" }
  | { value: string; type: "oauth"; expires?: number }
  | { value: null; type: "none" }
) & { identityDigest: string };

function secretPath(): string { return path.join(kithSpaceHome(), "secrets", "advisor-credentials.json"); }
function encryptionKey(): Buffer { return createHmac("sha256", getContentHmacKey()).update("advisor-credential-file-v1").digest(); }
function identity(value: string): string { return createHmac("sha256", getContentHmacKey()).update(`advisor-credential-identity\0${value}`).digest("hex"); }

export class ProviderCredentialPort {
  private readonly activations = new Map<string, Activation>();

  storeKithSecret(backendId: string, value: string): { credentialRef: string; credentialIdentityDigest: string } {
    if (!backendId || !value || value.length > 64 * 1024) throw new AdvisorProviderError("provider_auth_required");
    const ref = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`${ref}\0${backendId}`));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const file = this.readFile();
    file.entries[ref] = { kind: "kith_secret", backendId, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    this.writeFile(file);
    return { credentialRef: ref, credentialIdentityDigest: identity(`${backendId}\0${value}`) };
  }

  storePiCliSource(backendId: string, root: string, secretSourceIdentity: string): { credentialRef: string; credentialIdentityDigest: string } {
    const ref = randomUUID();
    const value = JSON.stringify({ root, secretSourceIdentity });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`${ref}\0${backendId}`));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const file = this.readFile();
    file.entries[ref] = { kind: "pi_cli_source", backendId, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    this.writeFile(file);
    return { credentialRef: ref, credentialIdentityDigest: identity(`${backendId}\0${secretSourceIdentity}`) };
  }

  envIdentity(name: string): string {
    const value = process.env[name];
    if (!value) throw new AdvisorProviderError("provider_auth_required");
    return identity(`${name}\0${value}`);
  }

  keylessIdentity(): string { return identity("keyless_local"); }

  identityForStoredRef(ref: string, expectedBackendId: string, expectedKind: "kith_secret" | "pi_cli_auth"): string {
    const stored = this.readFile().entries[ref];
    if (!stored || stored.backendId !== expectedBackendId) throw new AdvisorProviderError("provider_auth_required");
    const value = this.decrypt(ref, stored);
    if (expectedKind === "kith_secret" && stored.kind !== "pi_cli_source") return identity(`${stored.backendId}\0${value}`);
    if (expectedKind === "pi_cli_auth" && stored.kind === "pi_cli_source") {
      const source = JSON.parse(value) as { secretSourceIdentity?: unknown };
      if (typeof source.secretSourceIdentity === "string") return identity(`${stored.backendId}\0${source.secretSourceIdentity}`);
    }
    throw new AdvisorProviderError("provider_auth_required");
  }

  issue(input: Omit<Activation, "ref" | "source"> & {
    credentialRef: string | null;
    credentialSourceKind: AdvisorCredentialSourceKind;
  }): string {
    const now = Date.now();
    if (input.expiresAt <= now || input.expiresAt > now + 120_000) throw new AdvisorProviderError("provider_auth_required");
    for (const [handle, activation] of this.activations) {
      if (activation.expiresAt <= now) this.activations.delete(handle);
    }
    const handle = randomUUID();
    this.activations.set(handle, {
      audience: input.audience,
      source: input.credentialSourceKind,
      ref: input.credentialRef,
      runId: input.runId,
      providerEpoch: input.providerEpoch,
      workerGeneration: input.workerGeneration,
      executionSnapshotDigest: input.executionSnapshotDigest,
      expiresAt: input.expiresAt,
      backendId: input.backendId,
      apiKind: input.apiKind,
      expectedCredentialIdentityDigest: input.expectedCredentialIdentityDigest,
    });
    return handle;
  }

  redeem(handle: string, binding: Pick<Activation, "runId" | "providerEpoch" | "workerGeneration" | "executionSnapshotDigest">): RedeemedProviderCredential {
    const activation = this.activations.get(handle);
    this.activations.delete(handle);
    if (!activation || activation.expiresAt <= Date.now()
      || activation.runId !== binding.runId
      || activation.providerEpoch !== binding.providerEpoch
      || activation.workerGeneration !== binding.workerGeneration
      || activation.executionSnapshotDigest !== binding.executionSnapshotDigest) {
      throw new AdvisorProviderError("provider_auth_required");
    }
    const verify = (credential: RedeemedProviderCredential): RedeemedProviderCredential => {
      if (credential.identityDigest !== activation.expectedCredentialIdentityDigest) throw new AdvisorProviderError("provider_auth_required");
      return credential;
    };
    if (activation.source === "keyless_local") return verify({ value: null, type: "none", identityDigest: identity("keyless_local") });
    if (activation.source === "env_ref") {
      const name = activation.ref ?? "";
      const value = advisorCredentialEnvAllowed(activation.backendId, activation.apiKind, name) ? process.env[name] : undefined;
      if (!value) throw new AdvisorProviderError("provider_auth_required");
      return verify({ value, type: "api_key", identityDigest: identity(`${name}\0${value}`) });
    }
    if (!(["kith_secret", "pi_cli_auth"] as AdvisorCredentialSourceKind[]).includes(activation.source) || !activation.ref) throw new AdvisorProviderError("provider_auth_required");
    const stored = this.readFile().entries[activation.ref];
    if (!stored) throw new AdvisorProviderError("provider_auth_required");
    try {
      const value = this.decrypt(activation.ref, stored);
      if (activation.source === "kith_secret" && stored.kind !== "pi_cli_source") return verify({ value, type: "api_key", identityDigest: identity(`${stored.backendId}\0${value}`) });
      if (activation.source !== "pi_cli_auth" || stored.kind !== "pi_cli_source") throw new AdvisorProviderError("provider_auth_required");
      const source = JSON.parse(value) as { root: string; secretSourceIdentity: string };
      const imported = new PiCliConfigImporter(undefined, getContentHmacKey()).import(source.root, {
        includeAuthProvider: stored.backendId,
        includeCredential: true,
      });
      if (imported.secretSourceIdentity !== source.secretSourceIdentity) throw new AdvisorProviderError("provider_model_config_changed");
      if (!imported.activationCredential) throw new AdvisorProviderError("provider_auth_required");
      return verify({
        value: imported.activationCredential.value,
        type: imported.activationCredential.type,
        ...(imported.activationCredential.expires ? { expires: imported.activationCredential.expires } : {}),
        identityDigest: identity(`${stored.backendId}\0${source.secretSourceIdentity}`),
      });
    } catch (error) {
      if (error instanceof AdvisorProviderError) throw error;
      throw new AdvisorProviderError("provider_auth_required");
    }
  }

  revokeAll(): void { this.activations.clear(); }
  revoke(handle: string): boolean { return this.activations.delete(handle); }
  revokeRuntimeBeforeEpoch(epoch: number): number {
    let revoked = 0;
    for (const [handle, activation] of this.activations) {
      if (activation.audience !== "chat_runtime" || activation.providerEpoch >= epoch) continue;
      this.activations.delete(handle);
      revoked += 1;
    }
    return revoked;
  }

  private readFile(): SecretFile {
    let fd: number | undefined;
    try {
      if (process.platform === "win32") {
        protectPrivatePath(path.dirname(secretPath()), "directory");
        protectPrivatePath(secretPath(), "file");
      }
      fd = openSync(secretPath(), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > 2 * 1024 * 1024 || unsafePosixFileMetadata(before, 0o077)) {
        throw new AdvisorProviderError("provider_auth_required");
      }
      const parsed = JSON.parse(readFileSync(fd, "utf8")) as SecretFile;
      const after = fstatSync(fd);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new AdvisorProviderError("provider_auth_required");
      }
      return parsed?.schemaVersion === 1 && parsed.entries && typeof parsed.entries === "object" ? parsed : { schemaVersion: 1, entries: {} };
    } catch (error: any) {
      if (error instanceof AdvisorProviderError) throw error;
      if (error?.code === "ENOENT") return { schemaVersion: 1, entries: {} };
      throw new AdvisorProviderError("provider_auth_required");
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  private writeFile(file: SecretFile): void {
    const target = secretPath();
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    protectPrivatePath(path.dirname(target), "directory");
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(file), { mode: 0o600, flag: "wx" });
    renameSync(temporary, target);
    protectPrivatePath(target, "file");
  }

  private decrypt(ref: string, stored: StoredSecret): string {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(stored.iv, "base64"));
    decipher.setAAD(Buffer.from(`${ref}\0${stored.backendId}`));
    decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
}

export const providerCredentialPort = new ProviderCredentialPort();
