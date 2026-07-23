import type { RuntimeId } from "../../local-runtime/runtimeCatalog.js";

export type RuntimeCredentialActivationErrorCode =
  | "activation_invalid"
  | "activation_expired"
  | "activation_unavailable"
  | "activation_binding_mismatch";

export class RuntimeCredentialActivationError extends Error {
  constructor(public readonly code: RuntimeCredentialActivationErrorCode) {
    super(code);
    this.name = "RuntimeCredentialActivationError";
  }
}

export interface RuntimeCredentialActivationDescriptor {
  activationId: string;
  runtimeSessionId: string;
  sessionGeneration: number;
  workerGeneration: number;
  runtimeId: RuntimeId;
  providerRevision: number;
  modelConfigurationRevision: number;
  runtimeProfileRevision: number;
  runtimeConfigurationEpoch: number;
  effectiveConfigDigest: string;
  expiresAt: string;
}

export interface ActivatedRuntimeCredential {
  value: string | null;
  type: "api_key" | "oauth" | "none";
  identityDigest: string;
}

type Activation = {
  descriptor: RuntimeCredentialActivationDescriptor;
  credential: ActivatedRuntimeCredential;
};

function validateDescriptor(descriptor: RuntimeCredentialActivationDescriptor, now: number): number {
  const expiresAt = Date.parse(descriptor.expiresAt);
  if (!descriptor.activationId
    || !descriptor.runtimeSessionId
    || !Number.isSafeInteger(descriptor.sessionGeneration)
    || descriptor.sessionGeneration < 1
    || !Number.isSafeInteger(descriptor.workerGeneration)
    || descriptor.workerGeneration < 1
    || !Number.isSafeInteger(descriptor.providerRevision)
    || descriptor.providerRevision < 1
    || !Number.isSafeInteger(descriptor.modelConfigurationRevision)
    || descriptor.modelConfigurationRevision < 1
    || !Number.isSafeInteger(descriptor.runtimeProfileRevision)
    || descriptor.runtimeProfileRevision < 1
    || !Number.isSafeInteger(descriptor.runtimeConfigurationEpoch)
    || descriptor.runtimeConfigurationEpoch < 1
    || !/^[0-9a-f]{64}$/i.test(descriptor.effectiveConfigDigest)
    || !Number.isFinite(expiresAt)) {
    throw new RuntimeCredentialActivationError("activation_invalid");
  }
  if (expiresAt <= now) throw new RuntimeCredentialActivationError("activation_expired");
  return expiresAt;
}

function sameBinding(
  left: RuntimeCredentialActivationDescriptor,
  right: RuntimeCredentialActivationDescriptor,
): boolean {
  return left.activationId === right.activationId
    && left.runtimeSessionId === right.runtimeSessionId
    && left.sessionGeneration === right.sessionGeneration
    && left.workerGeneration === right.workerGeneration
    && left.runtimeId === right.runtimeId
    && left.providerRevision === right.providerRevision
    && left.modelConfigurationRevision === right.modelConfigurationRevision
    && left.runtimeProfileRevision === right.runtimeProfileRevision
    && left.runtimeConfigurationEpoch === right.runtimeConfigurationEpoch
    && left.effectiveConfigDigest === right.effectiveConfigDigest
    && left.expiresAt === right.expiresAt;
}

export class RuntimeCredentialActivationPort {
  private readonly activations = new Map<string, Activation>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(
    descriptor: RuntimeCredentialActivationDescriptor,
    credential: ActivatedRuntimeCredential,
  ): RuntimeCredentialActivationDescriptor {
    const now = this.now();
    validateDescriptor(descriptor, now);
    for (const [activationId, activation] of this.activations) {
      if (Date.parse(activation.descriptor.expiresAt) <= now) this.activations.delete(activationId);
    }
    if (this.activations.has(descriptor.activationId)) {
      throw new RuntimeCredentialActivationError("activation_invalid");
    }
    this.activations.set(descriptor.activationId, {
      descriptor: { ...descriptor },
      credential: { ...credential },
    });
    return { ...descriptor };
  }

  redeem(descriptor: RuntimeCredentialActivationDescriptor): ActivatedRuntimeCredential {
    const activation = this.activations.get(descriptor.activationId);
    this.activations.delete(descriptor.activationId);
    if (!activation) throw new RuntimeCredentialActivationError("activation_unavailable");
    if (Date.parse(activation.descriptor.expiresAt) <= this.now()) {
      throw new RuntimeCredentialActivationError("activation_expired");
    }
    if (!sameBinding(activation.descriptor, descriptor)) {
      throw new RuntimeCredentialActivationError("activation_binding_mismatch");
    }
    return { ...activation.credential };
  }

  revoke(activationId: string): boolean {
    return this.activations.delete(activationId);
  }

  revokeSession(runtimeSessionId: string): number {
    let revoked = 0;
    for (const [activationId, activation] of this.activations) {
      if (activation.descriptor.runtimeSessionId !== runtimeSessionId) continue;
      this.activations.delete(activationId);
      revoked += 1;
    }
    return revoked;
  }

  revokeBeforeEpoch(epoch: number): number {
    let revoked = 0;
    for (const [activationId, activation] of this.activations) {
      if (activation.descriptor.runtimeConfigurationEpoch >= epoch) continue;
      this.activations.delete(activationId);
      revoked += 1;
    }
    return revoked;
  }

  revokeAll(): void {
    this.activations.clear();
  }
}

export const runtimeCredentialActivationPort = new RuntimeCredentialActivationPort();
