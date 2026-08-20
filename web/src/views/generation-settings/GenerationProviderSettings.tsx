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

type ArkView = {
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
  const [ark, setArk] = useState<ArkView | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftEndpoint, setDraftEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const result = await api("GET", "/api/settings/generation-providers") as { ark?: ArkView };
        if (!result.ark) {
          setLoadError(t("misc.generationLoadError"));
          return;
        }
        setArk(result.ark);
        setDraftEndpoint(result.ark.endpoint ?? "");
      } catch {
        setLoadError(t("misc.generationLoadError"));
      }
    })();
  }, [api, t]);

  const save = async (extra: { enabled?: boolean } = {}) => {
    setBusy(true);
    try {
      const result = await api("PATCH", "/api/settings/generation-providers", {
        name: "ark",
        ...(draftKey.trim() ? { apiKey: draftKey.trim() } : {}),
        endpoint: draftEndpoint.trim() || null,
        ...extra,
      }) as { ark?: ArkView };
      if (!result.ark) throw new Error("missing ark settings");
      setArk(result.ark);
      setDraftEndpoint(result.ark.endpoint ?? "");
      setDraftKey("");
      toast.info(t("misc.generationSaved"));
    } catch {
      toast.error(t("misc.generationSaveError"));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!ark) return <p className="text-sm text-muted-foreground">{t("misc.generationLoading")}</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("misc.generationIntro")}</p>
      <section className={SECTION_CLASS}>
        <FieldSet className="m-0 border-0 p-0">
          <FieldLegend className="text-base font-normal">
            {t("misc.generationArkTitle")}
          </FieldLegend>
          <FieldDescription>{t("misc.generationArkDesc")}</FieldDescription>
          <FieldGroup className="mt-4 gap-4">
            <Field>
              <FieldLabel htmlFor="generation-key-ark">{t("misc.generationApiKey")}</FieldLabel>
              <Input
                id="generation-key-ark"
                type="password"
                autoComplete="off"
                placeholder={ark.hasApiKey ? (ark.apiKeyHint ?? "••••") : t("misc.generationApiKeyPlaceholder")}
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
              />
              <FieldDescription>
                {ark.hasApiKey
                  ? t("misc.generationApiKeyConfigured", { source: ark.source, hint: ark.apiKeyHint ?? "••••" })
                  : t("misc.generationApiKeyMissing")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="generation-endpoint-ark">{t("misc.generationEndpoint")}</FieldLabel>
              <Input
                id="generation-endpoint-ark"
                value={draftEndpoint}
                onChange={(event) => setDraftEndpoint(event.target.value)}
                placeholder="https://ark.cn-beijing.volces.com/api/v3"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {t("misc.generationSave")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void save({ enabled: !ark.enabled })}
              >
                {ark.enabled ? t("misc.generationDisable") : t("misc.generationEnable")}
              </Button>
            </div>
          </FieldGroup>
        </FieldSet>
      </section>
    </div>
  );
}
