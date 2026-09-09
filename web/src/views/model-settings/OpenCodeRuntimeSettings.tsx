/**
 * OpenCode 运行器设置。
 *
 * 与 Codex 一样目前只读：服务端还没有 OpenCode 的写入适配器。
 * 如实显示 ~/.config/opencode/opencode.json 里读到的 provider 字典。
 */

import { LocalConfigPanel } from "./LocalConfigPanel.tsx";
import { useLocalRuntimeConfig } from "./useLocalRuntimeConfig.ts";

export function OpenCodeRuntimeSettings() {
  const { config, loading, error, unsupported, refresh } = useLocalRuntimeConfig("opencode");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <LocalConfigPanel
        runtimeLabel="OpenCode"
        config={config}
        loading={loading}
        error={error}
        unsupported={unsupported}
        onRefresh={() => void refresh()}
        emptyHint={
          <p style={{ margin: 0, fontSize: "12px", color: "var(--settings-muted)" }}>
            在 opencode.json 的 provider 里配置供应商后回来刷新。
          </p>
        }
      />
      <p style={{ margin: 0, fontSize: "12px", color: "var(--settings-muted)", lineHeight: 1.6 }}>
        OpenCode 配置目前是只读的。要修改请直接编辑 opencode.json，改完点上方的刷新。
      </p>
    </div>
  );
}
