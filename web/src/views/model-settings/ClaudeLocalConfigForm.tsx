/**
 * 编辑本机 Claude Code 配置（~/.claude/settings.json 的 env 块）。
 *
 * Claude Code 不是「供应商列表」结构：一份 settings.json 只描述一套接入，四个档位
 * （Haiku/Sonnet/Opus/Fable）各自映射到一个模型 id。所以这里是单表单，不是列表增删。
 *
 * 写入语义遵循服务端的补丁约定：空字符串 = 删除该项，未改动 = 不传。
 * 密钥框留空表示「不动本机已有凭据」，不会把它清掉。
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useStore } from "../../store.tsx";
import {
  patchClaudeLocalConfig,
  type ClaudeConfigPatch,
  type ClaudeTier,
  type LocalProvider,
} from "../../data/localRuntimeConfig.ts";

const TIERS: Array<{ tier: ClaudeTier; label: string; hint: string }> = [
  { tier: "haiku", label: "Haiku（快速）", hint: "轻量任务、子代理" },
  { tier: "sonnet", label: "Sonnet（均衡）", hint: "日常主力" },
  { tier: "opus", label: "Opus（强力）", hint: "复杂推理" },
  { tier: "fable", label: "Fable（最强）", hint: "最高能力档" },
];

interface ClaudeLocalConfigFormProps {
  provider: LocalProvider | null;
  onSaved: () => void;
  onCancel: () => void;
}

type TierDraft = Record<ClaudeTier, { modelId: string; displayName: string }>;

function initialTiers(provider: LocalProvider | null): TierDraft {
  const raw = provider?.claude?.tiers ?? {};
  const draft = {} as TierDraft;
  for (const { tier } of TIERS) {
    draft[tier] = {
      modelId: raw[tier]?.modelId ?? "",
      displayName: raw[tier]?.displayName ?? "",
    };
  }
  return draft;
}

/** 官方端点是 adapter 补的默认值，不是用户填的，回填时不该把它写成用户输入。 */
const OFFICIAL_ORIGIN = "https://api.anthropic.com";

export function ClaudeLocalConfigForm({ provider, onSaved, onCancel }: ClaudeLocalConfigFormProps) {
  const { api } = useStore();
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl && provider.baseUrl !== OFFICIAL_ORIGIN ? provider.baseUrl : "",
  );
  const [authToken, setAuthToken] = useState("");
  const [tiers, setTiers] = useState<TierDraft>(() => initialTiers(provider));
  const [maxContextTokens, setMaxContextTokens] = useState(
    provider?.claude?.maxContextTokens ? String(provider.claude.maxContextTokens) : "",
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    provider?.claude?.maxOutputTokens ? String(provider.claude.maxOutputTokens) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState<string[] | null>(null);

  const setTier = (tier: ClaudeTier, patch: Partial<{ modelId: string; displayName: string }>) => {
    setTiers((current) => ({ ...current, [tier]: { ...current[tier], ...patch } }));
  };

  /** 数字框：空表示删除该项（传 null），填了非法值就直接拦下不提交。 */
  const parseLimit = (raw: string): number | null | "invalid" => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value <= 0) return "invalid";
    return value;
  };

  const save = async () => {
    const context = parseLimit(maxContextTokens);
    const output = parseLimit(maxOutputTokens);
    if (context === "invalid" || output === "invalid") {
      setError("上下文与输出上限必须是正整数");
      return;
    }

    setSaving(true);
    setError("");
    setChanged(null);
    try {
      const patch: ClaudeConfigPatch = {
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        tiers: Object.fromEntries(TIERS.map(({ tier }) => [tier, {
          modelId: tiers[tier].modelId.trim(),
          displayName: tiers[tier].displayName.trim(),
        }])),
        maxContextTokens: context,
        maxOutputTokens: output,
      };
      // 留空 = 保留本机现有密钥，所以只有用户真的输入了才带上这个字段。
      if (authToken.trim()) patch.authToken = authToken.trim();

      const result = await patchClaudeLocalConfig(api, patch);
      setChanged(result.changedKeys);
      setAuthToken("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "写入 settings.json 失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-form" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, fontSize: "13px", color: "var(--settings-muted)", lineHeight: 1.6 }}>
        保存后只会改写 settings.json 里与模型相关的 env 变量，
        permissions、hooks 等其他配置原样保留。留空的档位会从配置里删除。
      </p>

      <label className="form-field">
        <span>API 地址</span>
        <input
          value={baseUrl}
          placeholder={OFFICIAL_ORIGIN}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>

      <label className="form-field">
        <span>API 密钥</span>
        <input
          type="password"
          value={authToken}
          placeholder={provider?.credential.configured ? "留空表示不修改本机已有密钥" : "填入 API 密钥"}
          autoComplete="off"
          onChange={(event) => setAuthToken(event.target.value)}
        />
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>档位映射</h4>
        {TIERS.map(({ tier, label, hint }) => (
          <div key={tier} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px", alignItems: "end" }}>
            <label className="form-field" style={{ margin: 0 }}>
              <span>{label}</span>
              <input
                value={tiers[tier].modelId}
                placeholder={`模型 id · ${hint}`}
                onChange={(event) => setTier(tier, { modelId: event.target.value })}
              />
            </label>
            <label className="form-field" style={{ margin: 0 }}>
              <span>展示名（可选）</span>
              <input
                value={tiers[tier].displayName}
                placeholder="界面里显示的名字"
                onChange={(event) => setTier(tier, { displayName: event.target.value })}
              />
            </label>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px" }}>
        <label className="form-field" style={{ margin: 0 }}>
          <span>上下文上限（可选）</span>
          <input
            value={maxContextTokens}
            inputMode="numeric"
            placeholder="非 claude- 前缀模型需要"
            onChange={(event) => setMaxContextTokens(event.target.value)}
          />
        </label>
        <label className="form-field" style={{ margin: 0 }}>
          <span>输出上限（可选）</span>
          <input
            value={maxOutputTokens}
            inputMode="numeric"
            placeholder="留空使用默认"
            onChange={(event) => setMaxOutputTokens(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p style={{ margin: 0, fontSize: "13px", color: "#d93025", fontWeight: 600 }} role="alert">{error}</p>
      ) : null}
      {changed ? (
        <p style={{ margin: 0, fontSize: "13px", color: "#197342", fontWeight: 600 }}>
          {changed.length ? `已更新：${changed.join("、")}` : "没有需要改动的字段"}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" className="button-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <><Loader2 size={16} className="is-spinning" /> 保存中…</> : "保存到本机配置"}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={saving}>
          取消
        </button>
      </div>
    </div>
  );
}
