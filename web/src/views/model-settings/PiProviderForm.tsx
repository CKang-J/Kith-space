/**
 * Pi Agent 供应商配置表单
 */

import { AlertCircle, CheckCircle, Eye, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ProviderPreset, ModelPreset } from "../../types/runtimeTypes";

interface PiProviderFormProps {
  preset: ProviderPreset | null;
  onSave: (config: PiProviderConfig) => Promise<void>;
  onCancel: () => void;
}

export interface PiProviderConfig {
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl: string;
  selectedModelId: string;
  apiFormat: string;
}

export function PiProviderForm({ preset, onSave, onCancel }: PiProviderFormProps) {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(preset?.canonicalOrigin || "");
  const [selectedModelId, setSelectedModelId] = useState(preset?.models?.[0]?.id || "");
  const [availableModels, setAvailableModels] = useState<ModelPreset[]>(preset?.models || []);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("请先输入 API Key");
      return;
    }

    if (!baseUrl.trim()) {
      setErrorMessage("请先输入 API 端点");
      return;
    }

    setIsFetchingModels(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/settings/pi-agent-config/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat: preset?.apiFormat || "openai-chat",
        }),
      });

      const result = await response.json();

      if (result.success && result.models) {
        const models: ModelPreset[] = result.models.map((m: any) => ({
          id: m.id,
          displayName: m.id,
          contextWindow: 0,
          maxOutputTokens: 0,
          inputCapabilities: [],
        }));

        setAvailableModels(models);

        if (models.length > 0 && !selectedModelId) {
          setSelectedModelId(models[0].id);
        }

        setConnectionStatus("success");
      } else {
        setErrorMessage(result.error || "获取模型列表失败");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "网络错误");
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setConnectionStatus("error");
      setErrorMessage("请输入 API Key");
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus("idle");
    setErrorMessage("");

    try {
      const response = await fetch("/api/settings/pi-agent-config/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          apiFormat: preset?.apiFormat || "openai-chat",
        }),
      });

      const result = await response.json();

      if (result.success) {
        setConnectionStatus("success");
      } else {
        setConnectionStatus("error");
        setErrorMessage(result.error || "连接测试失败");
      }
    } catch (error) {
      setConnectionStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "网络错误");
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("请输入 API Key");
      return;
    }

    if (!selectedModelId) {
      setErrorMessage("请选择模型");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      await onSave({
        providerId: preset?.id || "custom",
        providerName: preset?.name || "Custom",
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        selectedModelId,
        apiFormat: preset?.apiFormat || "openai-chat",
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="provider-form">
      <div className="provider-form-header">
        <div>
          <h3>{preset ? preset.name : "自定义配置"}</h3>
          {preset?.description && <p>{preset.description}</p>}
        </div>
        {preset?.websiteUrl && (
          <a
            href={preset.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="provider-website-link"
          >
            <span>访问官网</span>
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      <div className="provider-form-body">
        {/* API Key */}
        <div className="form-field">
          <label htmlFor="api-key">
            <span>API Key</span>
            {preset?.apiKeyUrl && (
              <a
                href={preset.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="form-field-link"
              >
                获取 API Key
              </a>
            )}
          </label>
          <div className="input-with-icon">
            <input
              id="api-key"
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
            <button
              type="button"
              className="input-icon-button"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? "隐藏" : "显示"}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Base URL */}
        <div className="form-field">
          <label htmlFor="base-url">
            <span>API 端点</span>
            {preset?.endpointCandidates && preset.endpointCandidates.length > 1 && (
              <select
                className="form-field-select"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              >
                {preset.endpointCandidates.map((endpoint) => (
                  <option key={endpoint} value={endpoint}>
                    {endpoint}
                  </option>
                ))}
              </select>
            )}
          </label>
          <input
            id="base-url"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
          />
        </div>

        {/* 模型选择 */}
        <div className="form-field">
          <label htmlFor="model">
            <span>模型</span>
            <button
              type="button"
              className="form-field-link"
              style={{
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '13px',
                color: 'var(--settings-primary)',
              }}
              onClick={handleFetchModels}
              disabled={isFetchingModels || !apiKey.trim() || !baseUrl.trim()}
            >
              {isFetchingModels ? (
                <>
                  <Loader2 size={12} className="is-spinning" />
                  <span>获取中...</span>
                </>
              ) : (
                <>
                  <RefreshCw size={12} />
                  <span>获取模型列表</span>
                </>
              )}
            </button>
          </label>
          {availableModels.length > 0 ? (
            <>
              <select
                id="model"
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
              >
                <option value="">请选择模型</option>
                {availableModels.map((model: ModelPreset) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                    {model.contextWindow && model.contextWindow > 0 && ` (${(model.contextWindow / 1000).toFixed(0)}k)`}
                  </option>
                ))}
              </select>
              {selectedModelId && (
                <div className="model-info">
                  {(() => {
                    const selectedModel = availableModels.find((m) => m.id === selectedModelId);
                    if (!selectedModel) return null;
                    return (
                      <>
                        {selectedModel.contextWindow && selectedModel.contextWindow > 0 && (
                          <span>上下文: {(selectedModel.contextWindow / 1000).toFixed(0)}k tokens</span>
                        )}
                        {selectedModel.inputCapabilities && selectedModel.inputCapabilities.length > 0 && (
                          <span>支持: {selectedModel.inputCapabilities.join(", ")}</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <input
              id="model"
              type="text"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              placeholder="输入模型 ID 或点击上方获取模型列表"
            />
          )}
        </div>

        {/* 连接测试 */}
        <div className="form-field">
          <button
            type="button"
            className="test-connection-button"
            onClick={handleTestConnection}
            disabled={isTestingConnection || !apiKey.trim()}
          >
            {isTestingConnection ? (
              <>
                <Loader2 size={16} className="is-spinning" />
                <span>测试中...</span>
              </>
            ) : (
              <>
                {connectionStatus === "success" && <CheckCircle size={16} />}
                {connectionStatus === "error" && <AlertCircle size={16} />}
                <span>测试连接</span>
              </>
            )}
          </button>
          {connectionStatus === "success" && (
            <p className="connection-status connection-status--success">
              ✓ 连接成功
            </p>
          )}
          {connectionStatus === "error" && errorMessage && (
            <p className="connection-status connection-status--error">
              ✗ {errorMessage}
            </p>
          )}
        </div>
      </div>

      <div className="provider-form-footer">
        <button type="button" className="button-secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={handleSave}
          disabled={isSaving || !apiKey.trim() || !selectedModelId}
        >
          {isSaving ? (
            <>
              <Loader2 size={16} className="is-spinning" />
              <span>保存中...</span>
            </>
          ) : (
            "保存配置"
          )}
        </button>
      </div>
    </div>
  );
}
