export type MemoryStatus = "proposed" | "active" | "superseded" | "archived" | "rejected";

export interface MemoryItem {
  memory: {
    id: string;
    ownerAgentId?: string | null;
    scope: string;
    kind: string;
    subjectRef?: { kind: string; id: string };
    subjectKey: string;
    predicateKey: string;
    currentRevision: number;
    status: MemoryStatus;
    confidence: number;
    importance: number;
    sensitivity: string;
    disclosure: string;
    validFrom?: string | number | null;
    validTo?: string | number | null;
    sourceAccess: string;
    deletionState?: string;
    createdBy?: ActorRef;
    updatedBy?: ActorRef;
    createdAt?: string | number;
    updatedAt?: string | number;
  };
  revision: MemoryRevision;
  evidence: MemoryEvidence[];
  tags: string[];
  evidenceCount?: number;
  inContinuityBundle?: boolean;
  lastRecall?: MemoryRecall | null;
  replacement?: { memoryId: string; relationType: string } | null;
  proposal?: Record<string, unknown> | null;
}

export interface ActorRef { type: string; id: string }

export interface MemoryRevision {
  revision: number;
  canonicalText: string;
  internalSummary?: string | null;
  shareableSummary?: string | null;
  disclosure: string;
  sensitivity: string;
  validFrom?: string | number | null;
  validTo?: string | number | null;
  createdBy?: ActorRef;
  createdAt?: string | number;
}

export interface MemoryEvidence {
  id: string;
  sourceKind: string;
  sourceId: string;
  sourceSurfaceId?: string | null;
  visibilityAtOccurrence?: string;
  assertedBy?: ActorRef;
  claimType?: string;
  memoryPolicy?: string;
  occurredAt?: string | number;
}

export interface MemoryRecall {
  targetSurfaceId?: string | null;
  projection?: string;
  reasons?: string[];
  scoreBreakdown?: Record<string, number>;
  recalledAt?: string | number;
}

export interface MemoryDetail extends MemoryItem {
  revisionHistory: MemoryRevision[];
  relations: Array<{
    id?: string;
    fromMemoryId: string;
    fromRevision?: number;
    toMemoryId: string;
    toRevision?: number;
    relationType: string;
    createdBy?: ActorRef;
    createdAt?: string | number;
  }>;
  advisorJob?: AdvisorJob | null;
  recalls: MemoryRecall[];
}

export interface AdvisorJob {
  id: string;
  status: string;
  provider?: string;
  model?: string | null;
  attemptCount?: number;
  candidateCount?: number;
  errorCode?: string | null;
  errorDetailRedacted?: string | null;
  validation?: { received: number; stored: number; rejected: number } | null;
  usage?: Record<string, unknown> | null;
  createdAt?: string | number;
  completedAt?: string | number | null;
}

export interface AdvisorState {
  settings: {
    enabled: number | boolean;
    autoActivatePrivate?: number | boolean;
    pausedAt?: string | number | null;
    dailyTokenLimit?: number;
    dailyCostMicrosLimit?: number;
    updatedAt?: string | number;
    approvedProviderRevision?: number | null;
    approvedModelProfileRevision?: number | null;
    approvedProviderEpoch?: number | null;
    consentPurpose?: string | null;
    consentSourceScope?: { public: boolean; private: boolean; dm: boolean } | null;
    consentEpoch?: number;
    installationIdentityDigest?: string | null;
    providerEpochMirror?: number | null;
    approvedEgressDigest?: string | null;
  };
  runtime: string;
  support: { toolIsolation: "enforced" | "unsupported"; reason?: string };
  systemProvider?: {
    settings: { executionMode: string; state: string; providerEpoch: number; installationIdentityDigest: string };
    provider?: { revision: number; adapterId: string; adapterVersion: string } | null;
    modelProfile?: { revision: number; profile: {
      backendId: string;
      modelId: string;
      dataPolicyRevision: string;
      dataPolicyProvenance: string;
      canonicalOrigin: string;
      credentialIdentityDigest: string;
      allowedEgress: string[];
    } } | null;
  };
  latestJob?: AdvisorJob | null;
}

export interface SuppressionRecord {
  scope: string;
  item: {
    id: string;
    scope?: "agent_private" | "space_shared";
    sourceKind: string;
    sourceId: string;
    status: string;
    createdAt?: string | number;
  };
}

export type MemoryRevisionMutationAction = "edit" | "correct";

export interface MemoryRevisionMutationPayload {
  canonicalText: string;
  internalSummary: string | null;
  shareableSummary: string | null;
  replacementMemoryId?: string;
  relationType?: "supersedes" | "contradicts";
}

export type Api = (method: string, path: string, body?: unknown) => Promise<any>;
