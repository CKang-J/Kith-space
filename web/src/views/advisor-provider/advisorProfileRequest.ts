export type AdvisorProfileSource = "manual" | "pi_cli_import" | "bundled_catalog";

export type AdvisorProfileForm = {
  backendId: string;
  modelId: string;
  apiKind: string;
  thinkingLevel: string;
  canonicalOrigin: string;
  credentialSourceKind: string;
  credentialRef: string;
  credentialValue: string;
  dataPolicyRevision: string;
  dataPolicyProvenance: string;
  networkClass: string;
  allowedEgress: string;
};

export function buildAdvisorProfileRequest(input: {
  profileSource: AdvisorProfileSource;
  profile: AdvisorProfileForm;
  bundledCatalog?: { sourceSnapshotDigest?: string } | null;
  importedCatalog?: { catalogDigest?: string; credential?: { credentialIdentityDigest?: string } } | null;
}) {
  const { profile, profileSource: source, bundledCatalog, importedCatalog } = input;
  return {
    sourceKind: source,
    sourceSnapshotDigest: source === "bundled_catalog" ? bundledCatalog?.sourceSnapshotDigest
      : source === "pi_cli_import" ? importedCatalog?.catalogDigest : `manual:${profile.backendId}:${profile.modelId}`,
    descriptorTrust: source === "bundled_catalog" ? "bundled_verified" : source === "pi_cli_import" ? "pi_cli_imported" : "manual",
    backendId: profile.backendId,
    modelId: profile.modelId,
    apiKind: profile.apiKind,
    thinkingLevel: profile.thinkingLevel,
    canonicalOrigin: profile.canonicalOrigin,
    credentialSourceKind: profile.credentialSourceKind,
    ...(profile.credentialSourceKind === "kith_secret"
      ? { credentialValue: profile.credentialValue }
      : {
          credentialRef: profile.credentialRef || null,
          ...(importedCatalog?.credential?.credentialIdentityDigest
            ? { credentialIdentityDigest: importedCatalog.credential.credentialIdentityDigest }
            : {}),
        }),
    providerSchemaVersion: 1,
    dataPolicyRevision: profile.dataPolicyRevision,
    dataPolicyProvenance: profile.dataPolicyProvenance,
    networkClass: profile.networkClass,
    allowedEgress: profile.allowedEgress.split(/\s*,\s*/).filter(Boolean),
    modelMetadata: { supportedThinking: [profile.thinkingLevel] },
  };
}
