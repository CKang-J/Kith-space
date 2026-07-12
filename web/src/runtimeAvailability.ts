export interface RuntimeAvailability {
  id: string;
  label: string;
  installed: boolean;
}

export function selectInstalledRuntime(current: string, runtimes: RuntimeAvailability[]): string {
  if (runtimes.some((runtime) => runtime.id === current && runtime.installed)) return current;
  return runtimes.find((runtime) => runtime.installed)?.id ?? "";
}
