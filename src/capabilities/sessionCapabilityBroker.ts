import { randomBytes } from "node:crypto";
import { TurnCapabilityClaimsSchema, type TurnCapabilityClaims } from "./contracts.js";
import { HarnessError } from "../harness/errors.js";

export interface BrokerSessionBinding {
  sessionId: string;
  sessionGeneration: number;
  spaceId: string;
  agentId: string;
}

interface BrokerSession {
  binding: BrokerSessionBinding;
  activation: TurnCapabilityClaims | null;
  closed: boolean;
}

/**
 * Stable session handles are intentionally powerless until a matching attempt activation exists.
 * Product operations remain unavailable until P-A10.2 installs durable turn claims.
 */
export class SessionCapabilityBroker {
  private readonly sessions = new Map<string, BrokerSession>();

  constructor(private readonly now: () => number = Date.now) {}

  openSession(binding: BrokerSessionBinding): string {
    const handle = randomBytes(32).toString("base64url");
    this.sessions.set(handle, { binding: { ...binding }, activation: null, closed: false });
    return handle;
  }

  activate(handle: string, rawClaims: TurnCapabilityClaims): TurnCapabilityClaims {
    const session = this.session(handle);
    const claims = TurnCapabilityClaimsSchema.parse(rawClaims);
    if (session.activation) {
      throw new HarnessError("attempt_lease_conflict", "session already has an active attempt", {
        sessionId: session.binding.sessionId,
        activationId: session.activation.activationId,
      });
    }
    if (
      claims.sessionId !== session.binding.sessionId
      || claims.sessionGeneration !== session.binding.sessionGeneration
      || claims.spaceId !== session.binding.spaceId
      || claims.agentId !== session.binding.agentId
    ) {
      throw new HarnessError("capability_scope_denied", "activation does not match its broker session", {
        sessionId: session.binding.sessionId,
        activationId: claims.activationId,
      });
    }
    if (claims.expiresAt <= this.now()) {
      throw new HarnessError("capability_expired", "activation is already expired", { activationId: claims.activationId });
    }
    session.activation = claims;
    return claims;
  }

  resolve(input: {
    sessionHandle: string;
    activationId: string;
    workerGeneration: number;
    sessionId?: string;
    turnId?: string;
    attemptId?: string;
  }): TurnCapabilityClaims {
    const session = this.session(input.sessionHandle);
    const claims = session.activation;
    if (!claims || claims.activationId !== input.activationId) {
      throw new HarnessError("capability_inactive", "broker session has no matching active attempt", {
        activationId: input.activationId,
      });
    }
    if (claims.expiresAt <= this.now()) {
      session.activation = null;
      throw new HarnessError("capability_expired", "attempt activation expired", { activationId: input.activationId });
    }
    if (claims.workerGeneration !== input.workerGeneration) {
      throw new HarnessError("worker_generation_stale", "attempt belongs to another Worker generation", {
        activationId: input.activationId,
        expected: claims.workerGeneration,
        actual: input.workerGeneration,
      });
    }
    if (input.sessionId && input.sessionId !== claims.sessionId) {
      throw new HarnessError("session_generation_stale", "attempt belongs to another runtime session", {
        expected: claims.sessionId,
        actual: input.sessionId,
      });
    }
    if (input.turnId && input.turnId !== claims.turnId) {
      throw new HarnessError("capability_scope_denied", "attempt belongs to another turn", { activationId: input.activationId });
    }
    if (input.attemptId && input.attemptId !== claims.attemptId) {
      throw new HarnessError("attempt_lease_conflict", "attempt identity does not match the activation", { activationId: input.activationId });
    }
    return claims;
  }

  renew(handle: string, activationId: string, expiresAt: number): TurnCapabilityClaims {
    const session = this.session(handle);
    const claims = session.activation;
    if (!claims || claims.activationId !== activationId) {
      throw new HarnessError("capability_inactive", "broker session has no matching active attempt", { activationId });
    }
    const now = this.now();
    if (claims.expiresAt <= now) {
      session.activation = null;
      throw new HarnessError("capability_expired", "attempt activation expired before renewal", { activationId });
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      throw new HarnessError("capability_expired", "attempt activation renewal must extend into the future", { activationId, expiresAt });
    }
    const renewed = TurnCapabilityClaimsSchema.parse({ ...claims, expiresAt });
    session.activation = renewed;
    return renewed;
  }

  deactivate(handle: string, activationId: string): boolean {
    const session = this.sessions.get(handle);
    if (!session || session.closed || session.activation?.activationId !== activationId) return false;
    session.activation = null;
    return true;
  }

  closeSession(handle: string): void {
    const session = this.sessions.get(handle);
    if (!session) return;
    session.activation = null;
    session.closed = true;
    this.sessions.delete(handle);
  }

  private session(handle: string): BrokerSession {
    const session = this.sessions.get(handle);
    if (!session || session.closed) {
      throw new HarnessError("capability_inactive", "unknown or closed broker session");
    }
    return session;
  }
}
