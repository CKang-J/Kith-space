/** Canvas Agent Gateway/MCP/CLI tools are enabled by default; set KITH_CANVAS_AGENT_EXECUTION=0|false|off to opt out (决策 40). */
export function isCanvasAgentExecutionEnabled(): boolean {
  const raw = process.env.KITH_CANVAS_AGENT_EXECUTION?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}
