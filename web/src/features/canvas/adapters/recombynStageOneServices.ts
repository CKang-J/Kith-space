import { QueryClient } from "@tanstack/react-query";

export class StageOneCapabilityUnavailable extends Error {
  constructor(capability: string) {
    super(`${capability} is unavailable in the Stage 1 in-memory Canvas harness`);
    this.name = "StageOneCapabilityUnavailable";
  }
}

const unavailable = (path: string) => Promise.reject(new StageOneCapabilityUnavailable(path));
const emptyQueryResult = {
  available: false,
  openrouterAvailable: false,
  models: [], imageModels: [], videoModels: [], items: [], sessions: [], skills: [], providers: [],
  hasMore: false, page: 1, total: 0, nextCursor: null,
};

function capabilityProxy(path: string): unknown {
  return new Proxy(() => unavailable(path), {
    get(_target, key) {
      const name = `${path}.${String(key)}`;
      if (key === "queryOptions") {
        return () => ({ queryKey: ["canvas-stage-one", path], queryFn: async () => emptyQueryResult, retry: false });
      }
      if (key === "infiniteOptions") return (options: Record<string, unknown> = {}) => ({
        queryKey: ["canvas-stage-one", path], queryFn: async () => emptyQueryResult,
        initialPageParam: options.initialPageParam ?? 1, getNextPageParam: () => undefined, retry: false,
      });
      if (key === "queryKey" || key === "mutationKey") return () => ["canvas-stage-one", path];
      if (key === "key") return () => ["canvas-stage-one", path];
      if (key === "mutationOptions") return () => ({ mutationFn: () => unavailable(path), retry: false });
      return capabilityProxy(name);
    },
    apply() {
      return unavailable(path);
    },
  });
}

/** Recombyn service boundary: preserve callers/UI while disabling cloud and Agent effects. */
export const apiClient = capabilityProxy("apiClient") as any;
export const apiQuery = capabilityProxy("apiQuery") as any;
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
});

export function getHttpStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) || undefined
    : undefined;
}

export function getHttpErrorBody(): undefined { return undefined; }
export function getHttpErrorDetail(): undefined { return undefined; }
export function getHttpErrorMessage(error: unknown, fallback = ""): string {
  return error instanceof Error ? error.message : fallback;
}
export function abortAfter(milliseconds: number, signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(milliseconds);
}
