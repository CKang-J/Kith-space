import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectInstalledRuntime, type RuntimeAvailability } from "./runtimeAvailability.ts";

export const LOCAL_RUNTIME_DEFAULT = "__default__";

export interface RuntimeModelOption {
  id: string;
  label?: string;
  thinking?: { levels: { value: string; label: string; description?: string }[]; default?: string };
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<any>;

export function useRuntimeDiscovery(api: ApiCall) {
  const { t } = useTranslation();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [runtime, setRuntime] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeAvailability[]>([]);
  const [runtimesLoading, setRuntimesLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<RuntimeModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [modelProbeRevision, setModelProbeRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRef.current("GET", "/api/local-runtime/runtimes");
        if (cancelled) return;
        const available = Array.isArray(data.runtimes) ? data.runtimes as RuntimeAvailability[] : [];
        setRuntimes(available);
        setRuntime((current) => selectInstalledRuntime(current, available));
        setRuntimeError(available.some((item) => item.installed) ? "" : t("members.noRuntimeInstalled"));
      } catch {
        if (!cancelled) setRuntimeError(t("members.runtimeDetectionFailed"));
      } finally {
        if (!cancelled) setRuntimesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const runtimeInstalled = runtimes.some((item) => item.id === runtime && item.installed);
  const supportsLocalDefault = runtime === "claude" || runtime === "codex";

  useEffect(() => {
    let cancelled = false;
    if (!runtime || !runtimeInstalled) {
      setModels([]); setModel(""); setModelError(""); setModelsLoading(false);
      return () => { cancelled = true; };
    }
    setModelsLoading(true);
    setModelError("");
    (async () => {
      try {
        const data = await apiRef.current("GET", `/api/local-runtime/models/${runtime}`);
        if (cancelled) return;
        if (data.error) {
          setModels([]); setModel(""); setReasoning(""); setModelError(t("members.modelDetectionFailed"));
          return;
        }
        const availableModels = Array.isArray(data.models) ? data.models as RuntimeModelOption[] : [];
        setModels(availableModels);
        setModel((current) => {
          const next = availableModels.some((item) => item.id === current)
            ? current
            : supportsLocalDefault ? LOCAL_RUNTIME_DEFAULT : (availableModels[0]?.id ?? "");
          setReasoning(availableModels.find((item) => item.id === next)?.thinking?.default ?? "");
          return next;
        });
      } catch {
        if (!cancelled) { setModels([]); setModel(""); setReasoning(""); setModelError(t("members.modelDetectionFailed")); }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modelProbeRevision, runtime, runtimeInstalled, supportsLocalDefault, t]);

  const selectModel = (next: string) => {
    setModel(next);
    setReasoning(models.find((item) => item.id === next)?.thinking?.default ?? "");
  };

  return {
    runtime,
    setRuntime,
    runtimeOptions: runtimes.map((item) => ({
      value: item.id,
      label: item.label,
      hint: item.installed ? t("members.runtimeInstalled") : t("members.runtimeNotInstalled"),
      disabled: !item.installed,
    })),
    runtimesLoading,
    runtimeError,
    runtimeInstalled,
    supportsLocalDefault,
    model,
    models,
    modelsLoading,
    modelError,
    selectModel,
    retryModels: () => setModelProbeRevision((revision) => revision + 1),
    reasoning,
    setReasoning,
  };
}
