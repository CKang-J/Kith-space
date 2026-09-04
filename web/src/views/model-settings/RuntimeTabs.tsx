/**
 * 运行器标签切换组件
 * 用于在不同运行器（Claude Code、Codex、Pi、OpenCode）之间切换
 */

import { Code2, Cpu, Sparkles, Zap } from "lucide-react";
import type { RuntimeId } from "../../types/runtimeTypes";

interface RuntimeTabsProps {
  activeRuntime: RuntimeId;
  onRuntimeChange: (runtimeId: RuntimeId) => void;
}

const RUNTIME_TABS = [
  {
    id: 'claude' as const,
    label: 'Claude Code',
    icon: Sparkles,
    color: '#D4915D',
  },
  {
    id: 'codex' as const,
    label: 'Codex',
    icon: Code2,
    color: '#10A37F',
  },
  {
    id: 'pi' as const,
    label: 'Pi Agent',
    icon: Zap,
    color: '#FF6B35',
  },
  {
    id: 'opencode' as const,
    label: 'OpenCode',
    icon: Cpu,
    color: '#8B5CF6',
  },
];

export function RuntimeTabs({ activeRuntime, onRuntimeChange }: RuntimeTabsProps) {
  return (
    <div className="runtime-tabs">
      {RUNTIME_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeRuntime === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            className={`runtime-tab ${isActive ? 'runtime-tab--active' : ''}`}
            onClick={() => onRuntimeChange(tab.id)}
            style={{
              '--runtime-color': tab.color,
            } as React.CSSProperties}
          >
            <Icon size={18} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
