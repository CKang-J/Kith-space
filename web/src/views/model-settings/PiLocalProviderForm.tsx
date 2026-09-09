/**
 * 编辑本机 Pi Agent 供应商（~/.pi/agent/models.json 的 providers[]）。
 *
 * Pi 把供应商定义和凭据分开存放，写入时服务端也分开落盘：供应商进 models.json，
 * API Key 进 auth.json。表单这一侧只需要区分「新建」和「改已有的」：
 * 改已有的时候供应商 id 不可变（它是 auth.json 的键，改了等于换一个供应商）。
 *
 * 模型清单可以手填，也可以按端点拉取。Pi 允许 models 为空（交给它自己动态拉），
 * 所以这里不强制填模型。
 */

import { useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "../../store.tsx";
import {
  writePiLocalProvider,
  type LocalProvider,
  type PiProviderWriteInput,
} from "../../data/localRuntimeConfig.ts";

interface PiLocalProviderFormProps {
  /** null 表示新建。 */
  provider: LocalProvider | null;
  onSaved: () => void;
  onCancel: () => void;
}

interface ModelDraft {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
}

const API_FORMATS = [
  { value: "openai-chat", label: "OpenAI 兼容（/chat/completions）" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

function toDrafts(provider: LocalProvider | null): ModelDraft[] {
  return (provider?.models ?? []).map((model) => ({
    id: model.id,
    name: model.displayName && model.displayName !== model.id ? model.displayName : "",
    contextWindow: model.contextWindow ? String(model.contextWindow) : "",
    maxTokens: model.maxOutputTokens ? String(model.maxOutputTokens) : "",
    reasoning: Boolean(model.reasoning),
  }));
}

export function PiLocalProviderForm({ provider, onSaved, onCancel }: PiLocalProviderFormProps) {
  const { api } = useStore();
  const isNew = provider === null;
  const [providerId, setProviderId] = useState(provider?.id ?? "");
  const [name, setName] = useState(provider?.displayName ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiFormat, setApiFormat] = useState(provider?.apiFormat ?? "openai-chat");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelDraft[]>(() => toDrafts(provider));
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  const setModel = (index: number, patch: Partial<ModelDraft>) => {
    setModels((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addModel = () => {
    setModels((current) => [...current, { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false }]);
  };

  const removeModel = (index: number) => {
    setModels((current) => current.filter((_, i) => i !== index));
  };

  /**
   * 按端点拉取模型列表。需要密钥才能调用，而本机已存的密钥不会回传到浏览器，
   * 所以编辑已有供应商时也得让用户重新输入一次密钥才能拉。
   */
  const fetchModels = async () => {
    if (!apiKey.trim()) {
      setError("拉取模型需要先填入 API 密钥（本机已存的密钥不会回传到浏览器）");
      return;
    }
    if (!baseUrl.trim()) {
      setError("拉取模型需要先填入 API 地址");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const result = await api("POST", "/api/settings/pi-agent-config/fetch-models", {
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        apiFormat,
      });
      if (!result?.success || !Array.isArray(result.models)) {
        throw new Error(result?.error ?? "拉取模型失败");
      }
      const fetched = result.models as Array<{ id?: string }>;
      const ids = new Set(models.map((model) => model.id.trim()).filter(Boolean));
      const additions = fetched
        .map((model) => String(model.id ?? "").trim())
        .filter((id) => id && !ids.has(id))
        .map((id) => ({ id, name: "", contextWindow: "", maxTokens: "", reasoning: false }));
      if (additions.length === 0) {
        setError("没有拉到新的模型");
        return;
      }
      setModels((current) => [...current, ...additions]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉取模型失败");
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    const id = providerId.trim();
    if (!id) {
      setError("供应商 id 不能为空");
      return;
    }
    const cleaned = models
      .map((model) => ({ ...model, id: model.id.trim() }))
      .filter((model) => model.id);
    const duplicate = cleaned.find((model, index) => cleaned.findIndex((m) => m.id === model.id) !== index);
    if (duplicate) {
      setError(`模型 id 重复：${duplicate.id}`);
      return;
    }
    for (const model of cleaned) {
      for (const [field, raw] of [["上下文窗口", model.contextWindow], ["最大输出", model.maxTokens]] as const) {
        if (!raw.trim()) continue;
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          setError(`${model.id} 的${field}必须是正整数`);
          return;
        }
      }
    }

    setSaving(true);
    setError("");
    try {
      const input: PiProviderWriteInput = {
        id,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(apiFormat ? { api: apiFormat } : {}),
        // 留空 = 不动 auth.json 里已有的凭据。
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models: cleaned.map((model) => ({
          id: model.id,
          ...(model.name.trim() ? { name: model.name.trim() } : {}),
          ...(model.contextWindow.trim() ? { contextWindow: Number(model.contextWindow) } : {}),
          ...(model.maxTokens.trim() ? { maxTokens: Number(model.maxTokens) } : {}),
          ...(model.reasoning ? { reasoning: true } : {}),
        })),
      };
      await writePiLocalProvider(api, input);
      setApiKey("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "写入 models.json 失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-form" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>
        {isNew ? "添加本机供应商" : `编辑 ${provider?.displayName ?? providerId}`}
      </h4>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px" }}>
        <label className="form-field" style={{ margin: 0 }}>
          <span>供应商 id</span>
          <input
            value={providerId}
            disabled={!isNew}
            placeholder="例如 deepseek"
            onChange={(event) => setProviderId(event.target.value)}
          />
        </label>
        <label className="form-field" style={{ margin: 0 }}>
          <span>显示名（可选）</span>
          <input value={name} placeholder="界面里显示的名字" onChange={(event) => setName(event.target.value)} />
        </label>
      </div>

      <label className="form-field">
        <span>API 地址</span>
        <input value={baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} />
      </label>

      <label className="form-field">
        <span>接口类型</span>
        <select value={apiFormat} onChange={(event) => setApiFormat(event.target.value)}>
          {API_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>{format.label}</option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span>API 密钥</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={provider?.credential.configured ? "留空表示不修改本机已有密钥" : "填入 API 密钥"}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700 }}>模型清单</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="button-secondary" onClick={() => void fetchModels()} disabled={fetching}>
            {fetching ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />}
            按端点拉取
          </button>
          <button type="button" className="button-secondary" onClick={addModel}>
            <Plus size={14} />
            手动添加
          </button>
        </div>
      </div>

      {models.length === 0 ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--settings-muted)" }}>
          没有模型也可以保存，Pi 会在使用时自己拉取并缓存到 models-store.json。
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          {models.map((model, index) => (
            <li key={index} style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto auto",
              gap: "6px",
              alignItems: "center",
            }}>
              <input
                value={model.id}
                placeholder="模型 id"
                aria-label={`第 ${index + 1} 个模型的 id`}
                onChange={(event) => setModel(index, { id: event.target.value })}
              />
              <input
                value={model.name}
                placeholder="显示名（可选）"
                aria-label={`第 ${index + 1} 个模型的显示名`}
                onChange={(event) => setModel(index, { name: event.target.value })}
              />
              <input
                value={model.contextWindow}
                placeholder="上下文"
                inputMode="numeric"
                aria-label={`第 ${index + 1} 个模型的上下文窗口`}
                onChange={(event) => setModel(index, { contextWindow: event.target.value })}
              />
              <input
                value={model.maxTokens}
                placeholder="最大输出"
                inputMode="numeric"
                aria-label={`第 ${index + 1} 个模型的最大输出`}
                onChange={(event) => setModel(index, { maxTokens: event.target.value })}
              />
              <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={model.reasoning}
                  onChange={(event) => setModel(index, { reasoning: event.target.checked })}
                />
                推理
              </label>
              <button
                type="button"
                className="button-secondary"
                aria-label={`删除第 ${index + 1} 个模型`}
                onClick={() => removeModel(index)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p style={{ margin: 0, fontSize: "13px", color: "#d93025", fontWeight: 600 }} role="alert">{error}</p>
      ) : null}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="button-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="is-spinning" /> : null}
          {saving ? "保存中…" : "保存到本机配置"}
        </button>
      </div>
    </div>
  );
}
