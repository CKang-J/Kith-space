/**
 * 模型设置主页面 - 运行器标签版本
 * 整合 RuntimeTabs 和各运行器的设置容器
 */

import { useState } from "react";
import { RuntimeTabs } from "./RuntimeTabs";
import { PiRuntimeSettings } from "./PiRuntimeSettings";
import { ClaudeRuntimeSettings } from "./ClaudeRuntimeSettings";
import { CodexRuntimeSettings } from "./CodexRuntimeSettings";
import { OpenCodeRuntimeSettings } from "./OpenCodeRuntimeSettings";
import type { RuntimeId } from "../../types/runtimeTypes";
import "./modelSettings.css";

export function ModelSettingsV2() {
  const [activeRuntime, setActiveRuntime] = useState<RuntimeId>("pi");

  return (
    <div className="model-settings-container">
      <div className="model-settings-header">
        <h1>模型设置</h1>
        <p>为不同运行器配置模型供应商</p>
      </div>

      <RuntimeTabs activeRuntime={activeRuntime} onRuntimeChange={setActiveRuntime} />

      <div className="model-settings-content">
        {activeRuntime === "pi" && <PiRuntimeSettings />}
        {activeRuntime === "claude" && <ClaudeRuntimeSettings />}
        {activeRuntime === "codex" && <CodexRuntimeSettings />}
        {activeRuntime === "opencode" && <OpenCodeRuntimeSettings />}
      </div>
    </div>
  );
}
