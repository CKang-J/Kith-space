/**
 * Codex 运行器设置。
 *
 * 目前只读：服务端还没有 Codex 的写入适配器（config.toml 是 TOML，改写要保留用户
 * 其余段落与注释，不能用「读 JSON 再整体写回」那套）。所以这里如实显示读到的内容，
 * 并告诉用户要改就去改配置文件本身，而不是给一个假的编辑框。
 */

import { LocalConfigPanel } from "./LocalConfigPanel.tsx";
import { useLocalRuntimeConfig } from "./useLocalRuntimeConfig.ts";

export function CodexRuntimeSettings() {
  const { config, loading, error, unsupported, refresh } = useLocalRuntimeConfig("codex");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <LocalConfigPanel
        runtimeLabel="Codex"
        config={config}
        loading={loading}
        error={error}
        unsupported={unsupported}
        onRefresh={() => void refresh()}
        emptyHint={
          <p style={{ margin: 0, fontSize: "12px", color: "var(--settings-muted)" }}>
            在 config.toml 里配置 model_providers 或 openai_base_url 后回来刷新。
          </p>
        }
      />
      <p style={{ margin: 0, fontSize: "12px", color: "var(--settings-muted)", lineHeight: 1.6 }}>
        Codex 配置目前是只读的。要修改请直接编辑 config.toml，改完点上方的刷新。
      </p>
    </div>
  );
}
