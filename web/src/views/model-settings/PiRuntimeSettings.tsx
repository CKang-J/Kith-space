/**
 * Pi Agent 运行器设置。
 *
 * 打开就显示 ~/.pi/agent/ 下真实读到的供应商与模型，并支持增删改、设默认模型。
 * Pi 是四个运行器里唯一有完整读写适配器的，所以这里的操作最全。
 *
 * 所有写操作走 store 的 api()：本机配置的写接口有 CSRF 校验，裸 fetch 会被拦。
 */

import { useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { useStore } from "../../store.tsx";
import { useConfirm } from "../../ConfirmModal.tsx";
import { useToast } from "../../toast.tsx";
import { LocalConfigPanel } from "./LocalConfigPanel.tsx";
import { PiLocalProviderForm } from "./PiLocalProviderForm.tsx";
import { useLocalRuntimeConfig } from "./useLocalRuntimeConfig.ts";
import {
  deletePiLocalProvider,
  setPiLocalDefaultModel,
  type LocalProvider,
} from "../../data/localRuntimeConfig.ts";

export function PiRuntimeSettings() {
  const { api } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const { config, loading, error, unsupported, refresh } = useLocalRuntimeConfig("pi");
  /** null = 没在编辑；"" = 在新建；其他 = 在编辑该 id 的供应商。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");

  const finishEditing = () => {
    setEditingId(null);
    void refresh();
  };

  const removeProvider = async (provider: LocalProvider) => {
    const ok = await confirm({
      title: `删除 ${provider.displayName}？`,
      message: "会从 models.json 移除这个供应商，并清掉 auth.json 里对应的密钥。其他供应商不受影响。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    setBusyId(provider.id);
    try {
      await deletePiLocalProvider(api, provider.id);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusyId("");
    }
  };

  const makeDefault = async (provider: LocalProvider, modelId: string) => {
    setBusyId(provider.id);
    try {
      await setPiLocalDefaultModel(api, provider.id, modelId);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "设置默认模型失败");
    } finally {
      setBusyId("");
    }
  };

  const editing = (provider: LocalProvider) => editingId === provider.id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <LocalConfigPanel
        runtimeLabel="Pi Agent"
        config={config}
        loading={loading}
        error={error}
        unsupported={unsupported}
        onRefresh={() => void refresh()}
        actions={editingId === null ? (
          <button type="button" className="button-secondary" onClick={() => setEditingId("")}>
            <Plus size={16} />
            添加供应商
          </button>
        ) : null}
        providerActions={(provider) => (editing(provider) ? null : (
          <>
            {/* 有模型且还不是默认时，才给「设为默认」——Pi 的默认模型是单选。 */}
            {provider.models.length > 0 && provider.models[0] ? (
              <button
                type="button"
                className="button-secondary"
                style={{ padding: "6px 12px", fontSize: "13px" }}
                disabled={busyId === provider.id}
                onClick={() => void makeDefault(provider, provider.defaultModelId ?? provider.models[0]!.id)}
                title="把这个供应商的模型设为 Pi 的默认模型"
              >
                <Star size={14} />
                设为默认
              </button>
            ) : null}
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "6px 12px", fontSize: "13px" }}
              disabled={busyId === provider.id}
              onClick={() => setEditingId(provider.id)}
            >
              编辑
            </button>
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "6px 12px", fontSize: "13px", color: "#d93025" }}
              disabled={busyId === provider.id}
              onClick={() => void removeProvider(provider)}
            >
              <Trash2 size={14} />
              删除
            </button>
          </>
        ))}
        providerDetail={(provider) => (editing(provider) ? (
          <PiLocalProviderForm
            provider={provider}
            onSaved={finishEditing}
            onCancel={() => setEditingId(null)}
          />
        ) : null)}
        emptyHint={editingId === null ? (
          <button type="button" className="button-primary" onClick={() => setEditingId("")}>
            添加第一个供应商
          </button>
        ) : null}
      />

      {/* 新建表单挂在列表外面：此时还没有对应的供应商卡片可以承载它。 */}
      {editingId === "" ? (
        <PiLocalProviderForm
          provider={null}
          onSaved={finishEditing}
          onCancel={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}
