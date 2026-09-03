import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store.tsx";
import type { CanvasGenerationJob } from "@/features/canvas/adapters/canvasCoreApi";

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
/** Rough completion hints mirroring the phase3 spec: image ~30s, video 60-300s, audio ~30s. */
const ESTIMATE_SECONDS: Record<string, number> = { image: 30, video: 120, audio: 30 };

function estimateHint(t: ReturnType<typeof useTranslation>["t"], jobType: string): string | null {
  const seconds = ESTIMATE_SECONDS[jobType];
  if (!seconds) return null;
  return seconds < 60
    ? t("chat.generationJob.estimateSeconds", { seconds })
    : t("chat.generationJob.estimateMinutes", { minutes: Math.round(seconds / 60) });
}

function GenerationJobRow({ job }: { job: CanvasGenerationJob }) {
  const { t } = useTranslation();
  const kind = t(`chat.generationJob.kind.${job.jobType}`, { defaultValue: job.jobType });
  if (job.status === "completed") {
    return (
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground" title={job.genPrompt}>
        <CheckCircle2 size={13} className="shrink-0" />
        <span>{t("chat.generationJob.completed", { kind })}</span>
      </div>
    );
  }
  if (job.status === "failed") {
    const summary = (job.errorMessage ?? "").trim().slice(0, 140) || t("chat.generationJob.failedUnknown");
    return (
      <div className="flex items-center gap-1.5 text-[13px] text-destructive" title={job.errorMessage ?? undefined}>
        <XCircle size={13} className="shrink-0" />
        <span className="truncate">{t("chat.generationJob.failed", { kind })}{summary ? ` · ${summary}` : ""}</span>
      </div>
    );
  }
  if (job.status === "cancelled") {
    return (
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground" title={job.genPrompt}>
        <Ban size={13} className="shrink-0" />
        <span>{t("chat.generationJob.cancelled", { kind })}</span>
      </div>
    );
  }
  const hint = estimateHint(t, job.jobType);
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground" title={job.genPrompt}>
      <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
      <span>
        {t("chat.generationJob.running", { kind, status: job.status })}
        {hint ? ` · ${hint}` : ""}
      </span>
    </div>
  );
}

/** Live progress for canvas_generation_job artifacts bound to a turn reply. Stops once every job is terminal. */
export function GenerationJobProgress({ turnId }: { turnId: string }) {
  const { api } = useStore();
  const [jobs, setJobs] = useState<CanvasGenerationJob[] | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api("GET", `/api/canvas-generation-jobs/by-turn/${turnId}`).catch(() => null);
      if (!live) return;
      const list = Array.isArray(result?.jobs) ? result.jobs as CanvasGenerationJob[] : [];
      setJobs(list);
      if (list.length > 0 && list.every((job) => TERMINAL_STATUSES.has(job.status))) return;
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, turnId]);

  if (!jobs?.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {jobs.map((job) => <GenerationJobRow key={job.id} job={job} />)}
    </div>
  );
}
