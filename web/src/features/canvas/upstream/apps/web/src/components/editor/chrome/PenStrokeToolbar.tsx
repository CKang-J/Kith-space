/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/PenStrokeToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowDownTray, HiOutlineCheck, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import { LuEraser } from 'react-icons/lu';
import { ColorPanelPopover } from '@recombyn-native/components/base/colorPanel';
import { DropdownPanel } from '@recombyn-native/components/base';
import { Icon } from '@recombyn-native/components/base/icon';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import {
  brushPreviewPath,
  DEFAULT_PENCIL_BRUSH_ID,
  findPencilBrush,
  isBrushPackFileName,
  listPencilBrushes,
  makeCustomStampBrush,
  parseBrushPackJson,
  serializeBrushPack,
  setCustomPencilBrushes,
  type PencilBrushDef,
  type PencilBrushId,
} from '@recombyn-native/components/rcb/tools/pencilBrushes';
import { preloadStampSrc } from '@recombyn-native/components/rcb/tools/stampTint';
import {
  setActiveTool,
  setPenStrokeColor,
  setPenStrokeOpacity,
  setPenStrokeWidth,
  setPencilBrushId,
  setPencilEraseMode,
  setPencilHardness,
  setPencilPressureEnabled,
} from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';

const CUSTOM_BRUSH_STORAGE_KEY = 'recombine-custom-pencil-brushes-v3';
const MAX_CUSTOM_BRUSHES = 48;
const MAX_BRUSH_FILE_BYTES = 2.5 * 1024 * 1024;
const LEGACY_CUSTOM_BRUSH_KEYS = [
  'recombine-custom-pencil-brushes-v1',
  'recombine-custom-pencil-brushes-v2',
];

type StoredBrush = {
  id: string;
  label: string;
  kind?: 'freehand' | 'stamp';
  stampSrc?: string;
  sizeFactor?: number;
  spacingFactor?: number;
  simulatePressure?: boolean;
  options?: PencilBrushDef['options'];
  createdAt?: number;
};

function parseStoredBrushes(raw: string | null): StoredBrush[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => {
      if (!b || typeof b.id !== 'string') return false;
      if (b.kind === 'freehand') return true;
      return typeof b.stampSrc === 'string' && String(b.stampSrc).startsWith('data:');
    });
  } catch {
    return [];
  }
}

function brushesToDefs(list: StoredBrush[]): PencilBrushDef[] {
  return list.map((b) => {
    if (b.kind === 'freehand' || (!b.stampSrc && b.options)) {
      return {
        id: b.id,
        label: b.label || 'Brush',
        custom: true,
        kind: 'freehand' as const,
        sizeFactor: b.sizeFactor ?? 1,
        simulatePressure: Boolean(b.simulatePressure),
        options: {
          thinning: Number(b.options?.thinning ?? 0.05),
          smoothing: Number(b.options?.smoothing ?? 0.45),
          streamline: Number(b.options?.streamline ?? 0.35),
          easing: (t: number) => t,
          start: {
            taper: Number((b.options?.start as any)?.taper ?? 0),
            cap: (b.options?.start as any)?.cap !== false,
          },
          end: {
            taper: Number((b.options?.end as any)?.taper ?? 0),
            cap: (b.options?.end as any)?.cap !== false,
          },
        },
      };
    }
    return makeCustomStampBrush({
      id: b.id,
      label: b.label || 'Brush',
      stampSrc: String(b.stampSrc || ''),
      sizeFactor: b.sizeFactor,
      spacingFactor: b.spacingFactor,
    });
  });
}

function defToStored(b: PencilBrushDef): StoredBrush {
  return {
    id: b.id,
    label: b.label,
    kind: b.kind === 'stamp' ? 'stamp' : 'freehand',
    stampSrc: b.stampSrc,
    sizeFactor: b.sizeFactor,
    spacingFactor: b.spacingFactor,
    simulatePressure: b.simulatePressure,
    options: b.options,
    createdAt: Date.now(),
  };
}

function persistCustomBrushes(list: StoredBrush[]) {
  localStorage.setItem(CUSTOM_BRUSH_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_BRUSHES)));
  const defs = brushesToDefs(list);
  setCustomPencilBrushes(defs);
  defs.forEach((d) => {
    if (d.stampSrc) preloadStampSrc(d.stampSrc);
  });
  return defs;
}

function hydrateCustomPencilBrushes(): PencilBrushDef[] {
  // Drop legacy custom stores — old tip/freehand leftovers were cluttering the wheel.
  try {
    for (const key of LEGACY_CUSTOM_BRUSH_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
  return persistCustomBrushes(parseStoredBrushes(localStorage.getItem(CUSTOM_BRUSH_STORAGE_KEY)));
}

function listStoredCustomBrushes(): StoredBrush[] {
  return parseStoredBrushes(localStorage.getItem(CUSTOM_BRUSH_STORAGE_KEY));
}

function addCustomPencilBrushes(incoming: PencilBrushDef[]): PencilBrushDef[] {
  const prev = listStoredCustomBrushes().filter((b) => !incoming.some((n) => n.id === b.id));
  const next: StoredBrush[] = [...incoming.map(defToStored), ...prev].slice(0, MAX_CUSTOM_BRUSHES);
  return persistCustomBrushes(next);
}

function addCustomPencilBrush(brush: PencilBrushDef): PencilBrushDef[] {
  return addCustomPencilBrushes([brush]);
}

function removeCustomPencilBrush(id: string): PencilBrushDef[] {
  return persistCustomBrushes(listStoredCustomBrushes().filter((b) => b.id !== id));
}

function readBrushImageFile(file: File): Promise<{ dataUrl: string; name: string }> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('invalid-type'));
      return;
    }
    if (file.size > MAX_BRUSH_FILE_BYTES) {
      reject(new Error('too-large'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error('unreadable'));
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, '') || 'Brush';
      resolve({ dataUrl, name: name.slice(0, 24) });
    };
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_BRUSH_FILE_BYTES) {
      reject(new Error('too-large'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsText(file);
  });
}

function BrushStrokePreview({
  brushId,
  color,
  hardness = 80,
  className,
}: {
  brushId: string;
  color: string;
  hardness?: number;
  className?: string;
}) {
  const brush = findPencilBrush(brushId);
  // Match canvas: tip brushes paint as SVG ribbon (no stamp soft-edge).
  const d = brushPreviewPath(brush, 9, hardness);
  return (
    <svg
      className={className}
      viewBox="0 0 120 28"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill={color} stroke="none" />
    </svg>
  );
}

type PenStrokeToolbarProps = {
  /** Which tool's options to show. */
  mode: 'pen' | 'pencil';
  /**
   * `anchor` — float above the bottom tool strip.
   * `dock` — fixed at page top-center; brush menu opens downward.
   */
  placement?: 'anchor' | 'dock';
  className?: string;
};

/**
 * Pen / pencil stroke bar: color + inline width slider (+ brush / eraser for pencil).
 */
function PenStrokeToolbar({
  mode,
  placement = 'anchor',
  className,
}: PenStrokeToolbarProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const isPencil = mode === 'pencil';
  const docked = placement === 'dock';
  const exitPenEdit = () => {
    // Let PenDrawFeature commit the open path, then ensure we leave the tool.
    window.dispatchEvent(new Event('resume:exit-pen'));
    dispatch(setActiveTool('select'));
  };
  const color = useSelector((s: any) => String(s.editor.penStrokeColor || '#333333'));
  const width = useSelector((s: any) => {
    const n = Number(s.editor.penStrokeWidth);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const brushId = useSelector((s: any) =>
    String(s.editor.pencilBrushId || DEFAULT_PENCIL_BRUSH_ID)
  ) as PencilBrushId;
  const eraseMode = useSelector((s: any) => Boolean(s.editor.pencilEraseMode));
  const pressureEnabled = useSelector((s: any) => s.editor.pencilPressureEnabled !== false);
  const hardness = useSelector((s: any) => {
    const n = Number(s.editor.pencilHardness);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 80;
  });
  /** Local while dragging so list previews don't re-tint every pointer move. */
  const [hardnessDraft, setHardnessDraft] = useState(hardness);
  useEffect(() => {
    setHardnessDraft(hardness);
  }, [hardness]);
  const opacity = useSelector((s: any) => {
    const n = Number(s.editor.penStrokeOpacity);
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 100;
  });
  const [brushRev, setBrushRev] = useState(0);
  const brushes = listPencilBrushes();
  const brush = findPencilBrush(brushId);
  const [brushOpen, setBrushOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const brushCloseTimer = useRef<number | null>(null);
  const brushOpenTimer = useRef<number | null>(null);
  const customFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    hydrateCustomPencilBrushes();
    setBrushRev((n) => n + 1);
  }, []);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current != null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const openBrushMenu = () => {
    if (eraseMode) return;
    clearTimer(brushCloseTimer);
    clearTimer(brushOpenTimer);
    // Delay so the "画笔" tip can show before the panel opens.
    brushOpenTimer.current = window.setTimeout(() => setBrushOpen(true), 280);
  };
  const scheduleCloseBrush = () => {
    clearTimer(brushOpenTimer);
    clearTimer(brushCloseTimer);
    brushCloseTimer.current = window.setTimeout(() => setBrushOpen(false), 160);
  };

  useEffect(() => {
    return () => {
      clearTimer(brushCloseTimer);
      clearTimer(brushOpenTimer);
    };
  }, []);

  useEffect(() => {
    if (!isPencil) setBrushOpen(false);
  }, [isPencil]);

  useEffect(() => {
    if (eraseMode) setBrushOpen(false);
  }, [eraseMode]);

  const onDeleteCustom = (id: string) => {
    removeCustomPencilBrush(id);
    setBrushRev((n) => n + 1);
    if (brushId === id) dispatch(setPencilBrushId(DEFAULT_PENCIL_BRUSH_ID));
  };

  const onAddCustomBrush = async (file: File | null) => {
    if (!file) return;
    try {
      if (isBrushPackFileName(file.name) || file.type === 'application/json') {
        const text = await readTextFile(file);
        const pack = parseBrushPackJson(text);
        const defs = pack.brushes.map((b, i) => ({
          ...b,
          id: b.custom ? b.id : `pack_${Date.now().toString(36)}_${i}_${b.id}`,
          custom: true,
          label: b.label || pack.name,
        }));
        addCustomPencilBrushes(defs);
        setBrushRev((n) => n + 1);
        if (defs[0]) dispatch(setPencilBrushId(defs[0].id));
        setBrushOpen(false);
        return;
      }
      const { dataUrl, name } = await readBrushImageFile(file);
      const id = `custom_${Date.now().toString(36)}`;
      const def = makeCustomStampBrush({ id, label: name, stampSrc: dataUrl });
      addCustomPencilBrush(def);
      setBrushRev((n) => n + 1);
      dispatch(setPencilBrushId(id));
      setBrushOpen(false);
    } catch {
      /* ignore invalid file */
    }
  };

  const onExportCustomPack = () => {
    const customs = listPencilBrushes().filter((b) => b.custom);
    if (!customs.length) return;
    const blob = new Blob([serializeBrushPack(customs, 'My brushes')], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brushes.brushpack.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const menuPos = docked
    ? 'absolute left-1/2 top-[calc(100%+8px)] z-40 -translate-x-1/2'
    : 'absolute bottom-[calc(100%+8px)] left-1/2 z-40 -translate-x-1/2';

  return (
    <div
      ref={rootRef}
      className={cn(
        docked
          ? 'pointer-events-auto'
          : 'pointer-events-auto absolute bottom-[calc(100%+10px)] left-1/2 z-30 -translate-x-1/2',
        className
      )}
    >
      <FloatingToolbar className="relative h-8 gap-1 px-2 py-0">
        <ColorPanelPopover
          value={color}
          onChange={(hex) => dispatch(setPenStrokeColor(hex))}
          opacity={opacity}
          onOpacityChange={(pct) => dispatch(setPenStrokeOpacity(pct))}
          showAlpha={isPencil}
          title="颜色"
          placement={docked ? 'bottom' : 'top'}
          offset={10}
          shiftMainAxis={false}
          className="inline-flex"
        >
          {({ open, hex, opacity: swatchOpacity }) => (
            <Tooltip tip={'颜色'} placement={docked ? 'bottom' : 'top'}>
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  open ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]',
                  eraseMode && 'opacity-40'
                )}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-black/15"
                  style={{
                    background: hex,
                    opacity: isPencil ? Math.max(0.05, swatchOpacity / 100) : 1,
                  }}
                />
              </span>
            </Tooltip>
          )}
        </ColorPanelPopover>

        <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden />

        {isPencil ? (
          <div
            className="relative"
            onMouseEnter={openBrushMenu}
            onMouseLeave={scheduleCloseBrush}
          >
            <Tooltip
              tip={`画笔：${brush.label}`}
              placement={docked ? 'bottom' : 'top'}
              disabled={eraseMode}
            >
              <button
                type="button"
                aria-label={`画笔：${brush.label}`}
                aria-expanded={brushOpen}
                disabled={eraseMode}
                onClick={() => {
                  if (eraseMode) return;
                  clearTimer(brushOpenTimer);
                  clearTimer(brushCloseTimer);
                  setBrushOpen((v) => !v);
                }}
                className={cn(
                  'inline-flex h-6 w-[7.5rem] shrink-0 items-center justify-center overflow-hidden rounded-md px-1.5 transition-colors',
                  brushOpen ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]',
                  eraseMode && 'cursor-not-allowed opacity-40'
                )}
              >
                <BrushStrokePreview
                  brushId={brush.id}
                  color={color}
                  hardness={hardnessDraft}
                  className="pointer-events-none block h-3.5 w-full"
                />
              </button>
            </Tooltip>

            {brushOpen && !eraseMode ? (
              <DropdownPanel
                className={cn(menuPos, 'w-[160px]')}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={openBrushMenu}
                onMouseLeave={scheduleCloseBrush}
              >
                <ul
                  key={brushRev}
                  className="flex max-h-[320px] w-full flex-col gap-0.5 overflow-y-auto overflow-x-hidden p-1"
                >
                  <li className="flex w-full items-center gap-0.5">
                    <Tooltip tip="导入 tip 图 / 笔刷包 (.brushpack.json)" placement="right">
                      <button
                        type="button"
                        aria-label="导入画笔"
                        className="inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
                        onClick={() => customFileRef.current?.click()}
                      >
                        <HiOutlinePlus className="h-4 w-4" />
                      </button>
                    </Tooltip>
                    <Tooltip tip="导出自定义笔刷包" placement="right">
                      <button
                        type="button"
                        aria-label="导出画笔包"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                        onClick={onExportCustomPack}
                      >
                        <HiOutlineArrowDownTray className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <input
                      ref={customFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml,.json,.brushpack,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        e.target.value = '';
                        onAddCustomBrush(f);
                      }}
                    />
                  </li>
                  {brushes.map((b) => {
                    const active = b.id === brush.id;
                    return (
                      <li key={b.id} className="group relative w-full">
                        <Tooltip tip={b.label} placement="right">
                          <button
                            type="button"
                            aria-label={b.label}
                            aria-pressed={active}
                            className={cn(
                              'relative flex h-9 w-full shrink-0 items-center overflow-hidden rounded-lg px-1.5 transition-colors',
                              active
                                ? 'bg-[var(--accent-soft)]'
                                : 'hover:bg-[var(--accent-soft)]',
                              b.custom && 'pr-7'
                            )}
                            onClick={() => {
                              dispatch(setPencilBrushId(b.id));
                              setBrushOpen(false);
                            }}
                          >
                            <BrushStrokePreview
                              brushId={b.id}
                              color={color}
                              hardness={hardnessDraft}
                              className="pointer-events-none block h-7 w-full"
                            />
                          </button>
                        </Tooltip>
                        {b.custom ? (
                          <Tooltip tip="删除" placement="right">
                            <button
                              type="button"
                              aria-label={`删除 ${b.label}`}
                              className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-black/5 hover:text-[var(--ink)] group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteCustom(b.id);
                              }}
                            >
                              <HiOutlineTrash className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </DropdownPanel>
            ) : null}
          </div>
        ) : null}

        {isPencil ? <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden /> : null}

        {/* Width */}
        <label
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] bg-[var(--accent-soft)] px-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          title={eraseMode ? '橡皮尺寸' : '粗细'}
        >
          <Icon name="editor-stroke-weight" className="h-3.5 w-3.5 shrink-0 text-[var(--ink)]" />
          <input
            type="number"
            min={1}
            max={200}
            value={width}
            onChange={(e) =>
              dispatch(
                setPenStrokeWidth(
                  Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1)))
                )
              )
            }
            className="h-full w-10 min-w-0 bg-transparent text-[11px] leading-none tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="shrink-0 text-[10px] text-[var(--muted)]">Px</span>
        </label>

        {isPencil ? (
          <>
            <span className="mx-0.5 h-4 w-px bg-[var(--line)]" aria-hidden />
            {/* Hardness: tip edge for stamps; pressure width / taper for vector ink. */}
            <label
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] bg-[var(--accent-soft)] px-1.5"
              onPointerDown={(e) => e.stopPropagation()}
              title={
                brush.kind === 'stamp'
                  ? '硬度（笔尖边缘软硬）'
                  : '硬度（软=压感粗细更明显，硬=更均匀）'
              }
            >
              <span className="shrink-0 text-[10px] text-[var(--muted)]">硬</span>
              <input
                type="range"
                min={0}
                max={100}
                value={hardnessDraft}
                disabled={eraseMode}
                onChange={(e) => setHardnessDraft(Math.round(Number(e.target.value) || 0))}
                onPointerUp={() => dispatch(setPencilHardness(hardnessDraft))}
                onBlur={() => dispatch(setPencilHardness(hardnessDraft))}
                className="h-1 w-14 cursor-pointer accent-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="硬度"
              />
              <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-[var(--muted)]">
                {hardnessDraft}
              </span>
            </label>
            <span className="mx-0.5 h-4 w-px bg-[var(--line)]" aria-hidden />
            <Tooltip
              tip={pressureEnabled ? '\u538b\u611f\uff1a\u5f00' : '\u538b\u611f\uff1a\u5173'}
              placement={docked ? 'bottom' : 'top'}
            >
              <button
                type="button"
                aria-label={'\u538b\u611f'}
                aria-pressed={pressureEnabled}
                disabled={eraseMode}
                onClick={() => dispatch(setPencilPressureEnabled(!pressureEnabled))}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  pressureEnabled
                    ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                    : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]',
                  eraseMode && 'cursor-not-allowed opacity-40'
                )}
              >
                <Icon name="editor-pressure" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden />
            <Tooltip tip={'\u64e6\u76ae\u64e6'} placement={docked ? 'bottom' : 'top'}>
              <button
                type="button"
                aria-label={'\u64e6\u76ae\u64e6'}
                aria-pressed={eraseMode}
                onClick={() => dispatch(setPencilEraseMode(!eraseMode))}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  eraseMode
                    ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                    : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
                )}
              >
                <LuEraser className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden />
            <Tooltip tip={`${t('editor.exitPenEdit')} (Esc)`} placement={docked ? 'bottom' : 'top'}>
              <button
                type="button"
                aria-label={t('editor.exitPenEdit')}
                onClick={exitPenEdit}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--ink)] text-[var(--on-brand)] transition-opacity hover:opacity-90"
              >
                <HiOutlineCheck className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </Tooltip>
          </>
        )}
      </FloatingToolbar>
    </div>
  );
}

export default memo(PenStrokeToolbar);
