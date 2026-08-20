import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/toast";

type ApiRequest = (method: string, path: string, body?: unknown) => Promise<unknown>;

type ProviderView = {
  hasApiKey: boolean;
  apiKeyHint: string | null;
  endpoint: string | null;
  source: "app.db" | "env" | "none";
  enabled: boolean;
};

const SECTION_CLASS = "rounded-2xl border border-border/40 bg-muted/25 p-6 text-card-foreground";

export function GenerationProviderSettings({ api }: { api: ApiRequest }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [ark, setArk] = useState<ProviderView | null>(null);
  const [openrouter, setOpenrouter] = useState<ProviderView | null>(null);
  const [arkDraftKey, setArkDraftKey] = useState("");
  const [arkDraftEndpoint, setArkDraftEndpoint] = useState("");
  const [openrouterDraftKey, setOpenrouterDraftKey] = useState("");
  const [openrouterDraftEndpoint, setOpenrouterDraftEndpoint] = useState("");
  const [busy, setBusy] = useState<"ark" | "openrouter" | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const result = await api("GET", "/api/settings/generation-providers") as {
          ark?: ProviderView;
          openrouter?: ProviderView;
        };
        if (!result.ark) {
          setLoadError(t("misc.generationLoadError"));
          return;
        }
        setArk(result.ark);
        setArkDraftEndpoint(result.ark.endpoint ?? "");
        setOpenrouter(result.openrouter ?? {
          hasApiKey: false,
          apiKeyHint: null,
          endpoint: "https://openrouter.ai/api/v1",
          source: "none",
          enabled: false,
        });
        setOpenrouterDraftEndpoint(result.openrouter?.endpoint ?? "https://openrouter.ai/api/v1");
      } catch {
        setLoadError(t("misc.generationLoadError"));
      }
    })();
  }, [api, t]);

  const save = async (
    name: "ark" | "openrouter",
    extra: { enabled?: boolean } = {},
  ) => {
    setBusy(name);
    try {
      const draftKey = name === "ark" ? arkDraftKey : openrouterDraftKey;
      const draftEndpoint = name === "ark" ? arkDraftEndpoint : openrouterDraftEndpoint;
      const result = await api("PATCH", "/api/settings/generation-providers", {
        name,
        ...(draftKey.trim() ? { apiKey: draftKey.trim() } : {}),
        endpoint: draftEndpoint.trim() || null,
        ...extra,
      }) as { ark?: ProviderView; openrouter?: ProviderView };
      if (name === "ark") {
        if (!result.ark) throw new Error("missing ark settings");
        setArk(result.ark);
        setArkDraftEndpoint(result.ark.endpoint ?? "");
        setArkDraftKey("");
      } else {
        if (!result.openrouter) throw new Error("missing openrouter settings");
        setOpenrouter(result.openrouter);
        setOpenrouterDraftEndpoint(result.openrouter.endpoint ?? "");
        setOpenrouterDraftKey("");
      }
      toast.info(t("misc.generationSaved"));
    } catch {
      toast.error(t("misc.generationSaveError"));
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!ark || !openrouter) return <p className="text-sm text-muted-foreground">{t("misc.generationLoading")}</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("misc.generationIntro")}</p>
      <ProviderKeySection
        id="ark"
        title={t("misc.generationArkTitle")}
        description={t("misc.generationArkDesc")}
        view={ark}
        draftKey={arkDraftKey}
        draftEndpoint={arkDraftEndpoint}
        keyPlaceholder={t("misc.generationApiKeyPlaceholder")}
        endpointPlaceholder="https://ark.cn-beijing.volces.com/api/v3"
        missingKey={t("misc.generationApiKeyMissing")}
        busy={busy !== null}
        onDraftKeyChange={setArkDraftKey}
        onDraftEndpointChange={setArkDraftEndpoint}
        onSave={() => void save("ark")}
        onToggle={() => void save("ark", { enabled: !ark.enabled })}
        t={t}
      />
      <ProviderKeySection
        id="openrouter"
        title={t("misc.generationOpenRouterTitle")}
        description={t("misc.generationOpenRouterDesc")}
        view={openrouter}
        draftKey={openrouterDraftKey}
        draftEndpoint={openrouterDraftEndpoint}
        keyPlaceholder={t("misc.generationOpenRouterApiKeyPlaceholder")}
        endpointPlaceholder="https://openrouter.ai/api/v1"
        missingKey={t("misc.generationOpenRouterApiKeyMissing")}
        busy={busy !== null}
        onDraftKeyChange={setOpenrouterDraftKey}
        onDraftEndpointChange={setOpenrouterDraftEndpoint}
        onSave={() => void save("openrouter")}
        onToggle={() => void save("openrouter", { enabled: !openrouter.enabled })}
        t={t}
      />
    </div>
  );
}

function ProviderKeySection({
  id,
  title,
  description,
  view,
  draftKey,
  draftEndpoint,
  keyPlaceholder,
  endpointPlaceholder,
  missingKey,
  busy,
  onDraftKeyChange,
  onDraftEndpointChange,
  onSave,
  onToggle,
  t,
}: {
  id: string;
  title: string;
  description: string;
  view: ProviderView;
  draftKey: string;
  draftEndpoint: string;
  keyPlaceholder: string;
  endpointPlaceholder: string;
  missingKey: string;
  busy: boolean;
  onDraftKeyChange: (value: string) => void;
  onDraftEndpointChange: (value: string) => void;
  onSave: () => void;
  onToggle: () => void;
  t: (key: string, options?: Record<string, string>) => string;
}) {
  return (
    <section className={SECTION_CLASS}>
      <FieldSet className="m-0 border-0 p-0">
        <FieldLegend className="text-base font-normal">{title}</FieldLegend>
        <FieldDescription>{description}</FieldDescription>
        <FieldGroup className="mt-4 gap-4">
          <Field>
            <FieldLabel htmlFor={`generation-key-${id}`}>{t("misc.generationApiKey")}</FieldLabel>
            <Input
              id={`generation-key-${id}`}
              type="password"
              autoComplete="off"
              placeholder={view.hasApiKey ? (view.apiKeyHint ?? "••••") : keyPlaceholder}
              value={draftKey}
              onChange={(event) => onDraftKeyChange(event.target.value)}
            />
            <FieldDescription>
              {view.hasApiKey
                ? t("misc.generationApiKeyConfigured", { source: view.source, hint: view.apiKeyHint ?? "••••" })
                : missingKey}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`generation-endpoint-${id}`}>{t("misc.generationEndpoint")}</FieldLabel>
            <Input
              id={`generation-endpoint-${id}`}
              value={draftEndpoint}
              onChange={(event) => onDraftEndpointChange(event.target.value)}
              placeholder={endpointPlaceholder}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={busy} onClick={onSave}>
              {t("misc.generationSave")}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onToggle}>
              {view.enabled ? t("misc.generationDisable") : t("misc.generationEnable")}
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </section>
  );
}
