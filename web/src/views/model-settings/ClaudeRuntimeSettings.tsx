/**
 * Claude Code 运行器设置。
 *
 * 打开就显示用户 ~/.claude/settings.json 里真实的配置（端点、四个档位、上下文上限），
 * 并允许直接改写这些字段。Claude Code 一份配置只描述一套接入，所以没有「供应商列表」，
 * 编辑入口是单个表单。
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { LocalConfigPanel } from "./LocalConfigPanel.tsx";
import { ClaudeLocalConfigForm } from "./ClaudeLocalConfigForm.tsx";
import { useLocalRuntimeConfig } from "./useLocalRuntimeConfig.ts";

export function ClaudeRuntimeSettings() {
  const { config, loading, error, unsupported, refresh } = useLocalRuntimeConfig("claude");
  const [editing, setEditing] = useState(false);

  const provider = config?.providers[0] ?? null;

  const finishEditing = () => {
    setEditing(false);
    void refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <LocalConfigPanel
        runtimeLabel="Claude Code"
        config={config}
        loading={loading}
        error={error}
        unsupported={unsupported}
        onRefresh={() => void refresh()}
        actions={!editing && provider ? (
          <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} />
            编辑配置
          </button>
        ) : null}
        providerDetail={() => (editing ? (
          <ClaudeLocalConfigForm
            provider={provider}
            onSaved={finishEditing}
            onCancel={() => setEditing(false)}
          />
        ) : null)}
        emptyHint={
          editing ? null : (
            <button type="button" className="button-primary" onClick={() => setEditing(true)}>
              填写 Claude Code 配置
            </button>
          )
        }
      />

      {/* 一个供应商都没读到时，表单不会出现在卡片里，这里补一个挂载点。 */}
      {editing && !provider ? (
        <ClaudeLocalConfigForm
          provider={null}
          onSaved={finishEditing}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
