/**
 * 供应商预设网格组件
 * 显示当前运行器的所有预设供应商
 */

import { Heart, Search, SortAsc } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProviderPreset, ProviderCategory } from "../../types/runtimeTypes";

interface ProviderPresetGridProps {
  presets: ProviderPreset[];
  selectedId: string | null;
  onSelect: (preset: ProviderPreset | null) => void;
}

export function ProviderPresetGrid({
  presets,
  selectedId,
  onSelect,
}: ProviderPresetGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ProviderCategory | "all">("all");
  const [sortBy, setSortBy] = useState<"name" | "category">("category");

  const filteredAndSortedPresets = useMemo(() => {
    let filtered = presets;

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (preset) =>
          preset.name.toLowerCase().includes(query) ||
          preset.description?.toLowerCase().includes(query) ||
          preset.backendId.toLowerCase().includes(query)
      );
    }

    // 分类过滤
    if (categoryFilter !== "all") {
      filtered = filtered.filter((preset) => preset.category === categoryFilter);
    }

    // 排序
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "category") {
        // 先按分类排序：official > partner > community
        const categoryOrder = { official: 0, partner: 1, community: 2, custom: 3 };
        const orderDiff =
          categoryOrder[a.category] - categoryOrder[b.category];
        if (orderDiff !== 0) return orderDiff;
      }
      // 再按名称排序
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [presets, searchQuery, categoryFilter, sortBy]);

  return (
    <div className="provider-preset-grid-container">
      {/* 工具栏 */}
      <div className="preset-toolbar">
        <div className="preset-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索供应商..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="preset-filters">
          <button
            className={categoryFilter === "all" ? "active" : ""}
            onClick={() => setCategoryFilter("all")}
          >
            全部
          </button>
          <button
            className={categoryFilter === "official" ? "active" : ""}
            onClick={() => setCategoryFilter("official")}
          >
            官方
          </button>
          <button
            className={categoryFilter === "partner" ? "active" : ""}
            onClick={() => setCategoryFilter("partner")}
          >
            合作伙伴
          </button>
          <button
            className={categoryFilter === "community" ? "active" : ""}
            onClick={() => setCategoryFilter("community")}
            >
            社区
          </button>
        </div>

        <button
          className="preset-sort"
          onClick={() => setSortBy(sortBy === "name" ? "category" : "name")}
          title={sortBy === "name" ? "按名称排序" : "按分类排序"}
        >
          <SortAsc size={16} />
        </button>
      </div>

      {/* 预设网格 */}
      <div className="preset-grid">
        {filteredAndSortedPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-card ${selectedId === preset.id ? "selected" : ""}`}
            onClick={() => onSelect(preset)}
          >
            <div className="preset-card-header">
              <div
                className="preset-icon"
                style={{ backgroundColor: preset.iconColor || "#e1e2e4" }}
              >
                {preset.icon ? preset.icon.substring(0, 2).toUpperCase() : preset.name.substring(0, 2).toUpperCase()}
              </div>
              <div className="preset-badges">
                {preset.isOfficial && (
                  <span className="badge badge-official">官方</span>
                )}
                {preset.primePartner && (
                  <Heart size={14} className="badge-prime-icon" fill="currentColor" />
                )}
              </div>
            </div>
            <h4>{preset.name}</h4>
            {preset.description && <p>{preset.description}</p>}
            {preset.models && preset.models.length > 0 && (
              <div className="preset-models-count">
                {preset.models.length} 个预设模型
              </div>
            )}
          </button>
        ))}

        {/* 自定义配置选项 */}
        <button
          type="button"
          className={`preset-card preset-card-custom ${selectedId === "custom" ? "selected" : ""}`}
          onClick={() => onSelect(null)}
        >
          <div className="preset-card-header">
            <div className="preset-icon preset-icon-custom">
              <span style={{ fontSize: '20px' }}>⚙️</span>
            </div>
          </div>
          <h4>自定义配置</h4>
          <p>手动配置 API 端点和模型</p>
        </button>
      </div>

      {filteredAndSortedPresets.length === 0 && (
        <div className="preset-empty">
          <p>没有找到匹配的供应商</p>
          <button onClick={() => { setSearchQuery(""); setCategoryFilter("all"); }}>
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
