export const RUNTIME_CATALOG = [
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "copilot", label: "Copilot CLI", command: "copilot" },
  { id: "opencode", label: "OpenCode", command: "opencode" },
  { id: "kimi", label: "Kimi Code", command: "kimi" },
  { id: "pi", label: "Pi", command: "pi" },
  { id: "cursor", label: "Cursor", command: "cursor-agent" },
  { id: "hermes", label: "Hermes", command: "hermes" },
] as const;

export type RuntimeId = (typeof RUNTIME_CATALOG)[number]["id"];

export interface RuntimeAvailability {
  id: RuntimeId;
  label: string;
  installed: boolean;
}

export function runtimeAvailability(installedRuntimeIds: Iterable<string>): RuntimeAvailability[] {
  const installed = new Set(installedRuntimeIds);
  return RUNTIME_CATALOG
    .map(({ id, label }) => ({ id, label, installed: installed.has(id) }))
    .sort((a, b) => Number(b.installed) - Number(a.installed));
}

export function validateRuntimeModel(runtime: unknown, model: unknown): string | null {
  if (runtime !== "opencode") return null;
  if (typeof model !== "string" || !/^\S+\/\S+$/.test(model)) {
    return "OpenCode requires an explicit provider/model";
  }
  return null;
}
