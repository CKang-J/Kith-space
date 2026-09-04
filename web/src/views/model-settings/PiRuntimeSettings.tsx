/**
 * Pi Agent 运行器设置容器
 * 管理预设选择和配置表单的切换
 */

import { useState, useEffect } from "react";
import { ProviderPresetGrid } from "./ProviderPresetGrid";
import { PiProviderForm, type PiProviderConfig } from "./PiProviderForm";
import { PI_PROVIDER_PRESETS } from "../../data/piProviderPresets";
import type { ProviderPreset } from "../../types/runtimeTypes";

export function PiRuntimeSettings() {
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [savedProviders, setSavedProviders] = useState<PiProviderConfig[]>([]);

  useEffect(() => {
    // 加载已保存的配置
    loadSavedProviders();
  }, []);

  const loadSavedProviders = async () => {
    try {
      const response = await fetch("/api/settings/pi-agent-config");
      if (response.ok) {
        const data = await response.json();
        // 转换为前端格式
        const providers = data.providers?.map((p: any) => ({
          providerId: p.id,
          providerName: p.name,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          selectedModelId: p.models?.[0]?.id || "",
          apiFormat: p.apiFormat,
        })) || [];
        setSavedProviders(providers);
      }
    } catch (error) {
      console.error("Failed to load saved providers:", error);
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

  if (showForm) {
    return (
      <PiProviderForm
        preset={selectedPreset}
        onSave={handleSaveConfig}
        onCancel={handleCancelForm}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
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
                    onClick={async () => {
                      if (confirm(`确定删除 ${provider.providerName} 吗？`)) {
                        try {
                          await fetch(
                            `/api/settings/pi-agent-config/provider/${provider.providerId}`,
                            { method: "DELETE" }
                          );
                          await loadSavedProviders();
                        } catch (error) {
                          console.error("Failed to delete provider:", error);
                        }
                      }
                    }}
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
