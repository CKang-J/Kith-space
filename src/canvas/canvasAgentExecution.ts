/** Production Canvas Agent Gateway/MCP/CLI tools stay fail-closed unless explicitly enabled. */
export function isCanvasAgentExecutionEnabled(): boolean {
  const raw = process.env.KITH_CANVAS_AGENT_EXECUTION?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === "test";
}
