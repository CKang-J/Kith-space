/**
 * OpenCode 运行器设置容器
 */

import { useState } from "react";
import { AlertCircle, Upload } from "lucide-react";
import { ProviderPresetGrid } from "./ProviderPresetGrid";
import { OPENCODE_PROVIDER_PRESETS } from "../../data/opencodeProviderPresets";

export function OpenCodeRuntimeSettings() {
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleImportConfig = async () => {
    setImportStatus("loading");
    setErrorMessage("");

    try {
      const previewRes = await fetch("/api/settings/cli-imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtimeId: "opencode" }),
      });

      if (!previewRes.ok) {
        const error = await previewRes.json();
        throw new Error(error.error || "预览失败");
      }

      const preview = await previewRes.json();

      if (!preview.sourceMtimeDigest) {
        setImportStatus("error");
        setErrorMessage("未找到 OpenCode 配置文件");
        return;
      }

      const applyRes = await fetch("/api/settings/cli-imports/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeId: "opencode",
          sourceMtimeDigest: preview.sourceMtimeDigest,
        }),
      });

      if (!applyRes.ok) {
        const error = await applyRes.json();
        throw new Error(error.error || "导入失败");
      }

      setImportStatus("success");
      setTimeout(() => setImportStatus("idle"), 3000);
    } catch (error) {
      setImportStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "导入失败");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div
        style={{
          border: "1px solid #d1d2d5",
          borderRadius: "12px",
          padding: "16px 20px",
          background: "#f8f9fa",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <AlertCircle size={20} style={{ color: "#5f6368", flexShrink: 0, marginTop: "2px" }} />
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 700, color: "#202124" }}>
            从本地配置导入
          </h4>
          <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#5f6368", lineHeight: "1.5" }}>
            OpenCode 使用 JSON 配置文件。您可以导入现有配置，或使用下方预设创建新配置。
          </p>
          <button
            type="button"
            className="button-primary"
            style={{ padding: "8px 16px", fontSize: "13px" }}
            onClick={handleImportConfig}
            disabled={importStatus === "loading"}
          >
            {importStatus === "loading" ? (
              <>导入中...</>
            ) : (
              <>
                <Upload size={16} />
                导入本地配置
              </>
            )}
          </button>
          {importStatus === "success" && (
            <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#197342", fontWeight: 600 }}>
              ✓ 导入成功
            </p>
          )}
          {importStatus === "error" && errorMessage && (
            <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#d93025", fontWeight: 600 }}>
              ✗ {errorMessage}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>
          供应商预设
        </h3>
        <ProviderPresetGrid
          presets={OPENCODE_PROVIDER_PRESETS}
          selectedId={null}
          onSelect={(preset) => {
            if (preset) {
              alert(`OpenCode 配置表单即将推出\n\n选中供应商: ${preset.name}`);
            }
          }}
        />
      </div>
    </div>
  );
}
