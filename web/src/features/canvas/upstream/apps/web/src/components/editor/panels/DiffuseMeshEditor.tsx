/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/DiffuseMeshEditor.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlineArrowUturnLeft,
  HiOutlineArrowUturnRight,
  HiOutlineEye,
  HiOutlineEyeSlash,
} from 'react-icons/hi2';
import {
  ColorPanel,
  FILL_SOLID_PRESETS,
  normalizeHex,
} from '@recombyn-native/components/base/colorPanel';
import { SegmentedControl } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { cn } from '@recombyn-native/utils/classnames';
import {
  createMeshGrid,
  MESH_SIZES,
  remeshPoints,
  type MeshPoint,
  type MeshSize,
} from '@recombyn-native/components/rcb/scene/document/sceneDiffuseMesh';
import { defaultGradient, type FillGradient } from '@recombyn-native/components/rcb/scene/document/sceneFill';

type Props = {
  value?: FillGradient | null;
  baseColor?: string;
  onChange: (gradient: FillGradient) => void;
  /** Controlled selected mesh point (synced with on-canvas handles). */
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  showGuides?: boolean;
  onShowGuidesChange?: (show: boolean) => void;
};

type TabId = 'settings' | 'presets';

const PRESETS: Array<{ id: string; label: string; colors: string[] }> = [
  { id: 'pastel', label: 'Pastel', colors: ['#e4f5e0', '#fff3c4', '#d6eaf8', '#fce4ec', '#e8eaf6'] },
  { id: 'sunset', label: 'Sunset', colors: ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a18cd1', '#f6d365'] },
  { id: 'ocean', label: 'Ocean', colors: ['#667eea', '#48dbfb', '#1dd1a1', '#54a0ff', '#c8d6e5'] },
  { id: 'neon', label: 'Neon', colors: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#5f27cd'] },
  { id: 'mono', label: 'Mono', colors: ['#111827', '#6b7280', '#d1d5db', '#f9fafb', '#374151'] },
  { id: 'forest', label: 'Forest', colors: ['#134e4a', '#10b981', '#a7f3d0', '#065f46', '#fef3c7'] },
];

function clonePoints(points: MeshPoint[]): MeshPoint[] {
  return points.map((p) => ({ ...p }));
}

function ensureDiffuse(
  value: FillGradient | null | undefined,
  baseColor: string
): { meshSize: MeshSize; meshPoints: MeshPoint[] } {
  const base = defaultGradient('diffuse', baseColor);
  const size = (MESH_SIZES.includes(Number(value?.meshSize) as MeshSize)
    ? Number(value?.meshSize)
    : base.meshSize || 4) as MeshSize;
  const points =
    value?.type === 'diffuse' && value.meshPoints?.length
      ? remeshPoints(size, value.meshPoints, baseColor)
      : createMeshGrid(size, baseColor);
  return { meshSize: size, meshPoints: points };
}

function toGradient(meshSize: MeshSize, points: MeshPoint[], baseColor: string): FillGradient {
  return {
    type: 'diffuse',
    meshSize,
    meshPoints: clonePoints(points),
    colorStops: [
      { offset: 0, color: points[0]?.color || baseColor, opacity: 100 },
      { offset: 1, color: points[points.length - 1]?.color || baseColor, opacity: 100 },
    ],
  };
}

function applyPresetColors(points: MeshPoint[], colors: string[]): MeshPoint[] {
  if (!colors.length) return points;
  return points.map((p, i) => ({
    ...p,
    color: normalizeHex(colors[i % colors.length], p.color),
  }));
}

/**
 * Diffuse mesh settings panel — anchors are edited on-canvas (MeshHandlesOverlay).
 */
function DiffuseMeshEditor({
  value,
  baseColor = '#CCCCCC',
  onChange,
  selectedIndex: selectedProp,
  onSelectedIndexChange,
  showGuides: showGuidesProp,
  onShowGuidesChange,
}: Props): ReactNode {
  const { t } = useTranslation();
  const signature = useMemo(() => {
    if (value?.type !== 'diffuse') return `init:${baseColor}`;
    return `${value.meshSize}:${JSON.stringify(value.meshPoints)}`;
  }, [value, baseColor]);

  const initial = useMemo(() => ensureDiffuse(value, baseColor), [signature]);
  const [meshSize, setMeshSize] = useState<MeshSize>(initial.meshSize);
  const [points, setPoints] = useState<MeshPoint[]>(() => clonePoints(initial.meshPoints));
  const [selectedLocal, setSelectedLocal] = useState(0);
  const [showGuidesLocal, setShowGuidesLocal] = useState(true);
  const [tab, setTab] = useState<TabId>('settings');
  const [past, setPast] = useState<MeshPoint[][]>([]);
  const [future, setFuture] = useState<MeshPoint[][]>([]);

  const selected = selectedProp ?? selectedLocal;
  const showGuides = showGuidesProp ?? showGuidesLocal;
  const setSelected = (index: number) => {
    setSelectedLocal(index);
    onSelectedIndexChange?.(index);
  };
  const setShowGuides = (next: boolean | ((v: boolean) => boolean)) => {
    setShowGuidesLocal((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      onShowGuidesChange?.(v);
      return v;
    });
  };

  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef('');
  pointsRef.current = points;
  onChangeRef.current = onChange;

  const emit = useCallback(
    (size: MeshSize, pts: MeshPoint[]) => {
      const g = toGradient(size, pts, baseColor);
      const key = `${g.meshSize}:${JSON.stringify(g.meshPoints)}`;
      if (key === lastEmittedRef.current) return;
      lastEmittedRef.current = key;
      onChangeRef.current(g);
    },
    [baseColor]
  );

  useEffect(() => {
    if (signature === lastEmittedRef.current) return;
    const next = ensureDiffuse(value, baseColor);
    const key = `${next.meshSize}:${JSON.stringify(next.meshPoints)}`;
    lastEmittedRef.current = key;
    setMeshSize(next.meshSize);
    setPoints(clonePoints(next.meshPoints));
    setPast([]);
    setFuture([]);
  }, [signature, value, baseColor]);

  // Keep selection in range when mesh size changes from outside.
  const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);
  onSelectedIndexChangeRef.current = onSelectedIndexChange;
  useEffect(() => {
    if (selected >= points.length) {
      const next = Math.max(0, points.length - 1);
      setSelectedLocal(next);
      onSelectedIndexChangeRef.current?.(next);
    }
  }, [points.length, selected]);

  const pushHistory = useCallback((prev: MeshPoint[]) => {
    setPast((p) => [...p.slice(-40), clonePoints(prev)]);
    setFuture([]);
  }, []);

  const meshSizeRef = useRef(meshSize);
  meshSizeRef.current = meshSize;

  const undo = () => {
    setPast((p) => {
      if (!p.length) return p;
      const last = p[p.length - 1];
      setFuture((f) => [clonePoints(pointsRef.current), ...f]);
      const next = clonePoints(last);
      setPoints(next);
      emit(meshSizeRef.current, next);
      return p.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      const [nextPts, ...rest] = f;
      setPast((p) => [...p, clonePoints(pointsRef.current)]);
      const next = clonePoints(nextPts);
      setPoints(next);
      emit(meshSizeRef.current, next);
      return rest;
    });
  };

  const setMeshSizeAndRemesh = (size: MeshSize) => {
    pushHistory(points);
    const next = remeshPoints(size, points, baseColor);
    setMeshSize(size);
    setPoints(next);
    setSelected(0);
    emit(size, next);
  };

  const updatePoint = (index: number, patch: Partial<MeshPoint>, recordHistory = false) => {
    if (recordHistory) pushHistory(points);
    setPoints((prev) => {
      const next = prev.map((p, i) => (i === index ? { ...p, ...patch } : p));
      emit(meshSizeRef.current, next);
      return next;
    });
  };

  const active = points[selected] || points[0];

  return (
    <div className="space-y-3" data-diffuse-mesh-editor>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <Tooltip tip={t('editor.undo')} placement="top">
            <button
              type="button"
              disabled={!past.length}
              onClick={undo}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-35"
            >
              <HiOutlineArrowUturnLeft className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip tip={t('editor.redo')} placement="top">
            <button
              type="button"
              disabled={!future.length}
              onClick={redo}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-35"
            >
              <HiOutlineArrowUturnRight className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
        <p className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">
          {t('editor.fillMeshHint')}
        </p>
        <div className="flex items-center gap-0.5">
          <Tooltip
            tip={showGuides ? t('editor.fillMeshHideGuides') : t('editor.fillMeshShowGuides')}
            placement="top"
          >
            <button
              type="button"
              onClick={() => setShowGuides((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              {showGuides ? (
                <HiOutlineEye className="h-3.5 w-3.5" />
              ) : (
                <HiOutlineEyeSlash className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip tip={t('editor.fillDiffuse')} placement="top">
            <button
              type="button"
              onClick={() => {
                pushHistory(points);
                const next = createMeshGrid(meshSize, baseColor);
                setPoints(next);
                setSelected(0);
                emit(meshSize, next);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <HiOutlineArrowPath className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <SegmentedControl
        size="sm"
        fullWidth
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { value: 'settings' as const, label: t('editor.fillDiffuseSettings') },
          { value: 'presets' as const, label: t('editor.fillDiffusePresets') },
        ]}
      />

      {tab === 'settings' ? (
        <div className="space-y-3">
          <ColorPanel
            value={active?.color || baseColor}
            onChange={(hex) => updatePoint(selected, { color: hex }, true)}
            showAlpha={false}
            title=""
            showHeader={false}
            padded={false}
            presets={FILL_SOLID_PRESETS}
            className="w-full !shadow-none !ring-0"
          />

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">
              {t('editor.fillMeshSize')}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MESH_SIZES.map((n) => {
                const activeSize = meshSize === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMeshSizeAndRemesh(n)}
                    className={cn(
                      'h-8 rounded text-[12px] font-medium tabular-nums transition-colors',
                      activeSize
                        ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                        : 'bg-[var(--accent-soft)] text-[var(--muted)] hover:text-[var(--ink)]'
                    )}
                  >
                    {n} × {n}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                pushHistory(points);
                const next = applyPresetColors(points, preset.colors);
                setPoints(next);
                emit(meshSize, next);
              }}
              className="overflow-hidden rounded ring-1 ring-[var(--line)] transition hover:ring-[var(--ink)]/30"
            >
              <span
                className="block h-12 w-full"
                style={{
                  background: `linear-gradient(135deg, ${preset.colors.join(', ')})`,
                }}
              />
              <span className="block truncate px-1.5 py-1 text-left text-[11px] text-[var(--muted)]">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(DiffuseMeshEditor);
