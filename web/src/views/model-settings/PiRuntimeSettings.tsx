/**
 * Pi Agent 运行器设置容器
 * 显示本机现有配置并支持添加新供应商
 */

import { useState, useEffect } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { ProviderPresetGrid } from "./ProviderPresetGrid";
import { PiProviderForm, type PiProviderConfig } from "./PiProviderForm";
import { PI_PROVIDER_PRESETS } from "../../data/piProviderPresets";
import type { ProviderPreset } from "../../types/runtimeTypes";

export function PiRuntimeSettings() {
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [savedProviders, setSavedProviders] = useState<PiProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    loadSavedProviders();
  }, []);

  const loadSavedProviders = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/settings/pi-agent-config");
      if (response.ok) {
        const data = await response.json();
        // 转换为前端格式
        const providers = data.providers?.map((p: any) => ({
          providerId: p.id,
          providerName: p.name,
          apiKey: p.apiKey || "***",  // 不显示完整密钥
          baseUrl: p.baseUrl,
          selectedModelId: p.models?.[0]?.id || "",
          apiFormat: p.apiFormat,
        })) || [];
        setSavedProviders(providers);
      } else {
        const error = await response.json();
        setLoadError(error.error || "加载配置失败");
      }
    } catch (error) {
      console.error("Failed to load saved providers:", error);
      setLoadError("网络错误，无法加载配置");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPreset = (preset: ProviderPreset | null) => {
    setSelectedPreset(preset);
    setShowForm(true);
  };

  const handleSaveConfig = async (config: PiProviderConfig) => {
    try {
      // 构造 Pi Agent models.json 格式
      const provider = {
        id: config.providerId,
        name: config.providerName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        models: [
          {
            id: config.selectedModelId,
            displayName: selectedPreset?.models?.find((m) => m.id === config.selectedModelId)?.displayName,
          },
        ],
        apiFormat: config.apiFormat,
        enabled: true,
      };

      const response = await fetch("/api/settings/pi-agent-config/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "保存失败");
      }

      // 刷新列表
      await loadSavedProviders();

      // 返回预设选择界面
      setShowForm(false);
      setSelectedPreset(null);
    } catch (error) {
      console.error("Failed to save config:", error);
      throw error;
    }
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setSelectedPreset(null);
  };

  const handleDeleteProvider = async (providerId: string, providerName: string) => {
    if (!confirm(`确定删除 ${providerName} 吗？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/settings/pi-agent-config/provider/${providerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "删除失败");
      }

      await loadSavedProviders();
    } catch (error) {
      console.error("Failed to delete provider:", error);
      alert(`删除失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  if (showForm) {
    return (
      <PiProviderForm
        preset={selectedPreset}
        onSave={handleSaveConfig}
        onCancel={handleCancelForm}
      />
    );
  }

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px" }}>
        <Loader2 size={32} className="is-spinning" style={{ color: "var(--settings-muted)" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "60px" }}>
        <p style={{ color: "var(--settings-muted)", fontSize: "14px" }}>{loadError}</p>
        <button className="button-secondary" onClick={loadSavedProviders}>
          <RefreshCw size={16} />
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 配置说明 */}
      <div
        style={{
          border: "1px solid #e0e7ff",
          borderRadius: "12px",
          padding: "16px 20px",
          background: "#f5f7ff",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <AlertCircle size={20} style={{ color: "#6366f1", flexShrink: 0, marginTop: "2px" }} />
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 700, color: "#202124" }}>
            本机配置
          </h4>
          <p style={{ margin: 0, fontSize: "13px", color: "#5f6368", lineHeight: "1.5" }}>
            以下显示从 <code style={{ padding: "2px 6px", background: "#e8eaed", borderRadius: "4px", fontSize: "12px" }}>~/.pi/agent/models.json</code> 读取的配置。
            您可以直接使用现有配置，或添加新的供应商。
          </p>
        </div>
      </div>

      {/* 已保存的配置列表 */}
      {savedProviders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
            已配置的供应商
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {savedProviders.map((provider) => (
              <div
                key={provider.providerId}
                style={{
                  border: "1px solid var(--settings-border)",
                  borderRadius: "10px",
                  padding: "14px 16px",
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>
                    {provider.providerName}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--settings-muted)" }}>
                    {provider.selectedModelId}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="button-secondary"
                    style={{ padding: "6px 12px", fontSize: "13px" }}
                    onClick={() => {
                      const preset = PI_PROVIDER_PRESETS.find(
                        (p) => p.id === provider.providerId
                      );
                      setSelectedPreset(preset || null);
                      setShowForm(true);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    style={{ padding: "6px 12px", fontSize: "13px", color: "#d93025" }}
                    onClick={() => handleDeleteProvider(provider.providerId, provider.providerName)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 预设网格 */}
      <div>
        <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>
          添加供应商
        </h3>
        <ProviderPresetGrid
          presets={PI_PROVIDER_PRESETS}
          selectedId={null}
          onSelect={handleSelectPreset}
        />
      </div>
    </div>
  );
}
