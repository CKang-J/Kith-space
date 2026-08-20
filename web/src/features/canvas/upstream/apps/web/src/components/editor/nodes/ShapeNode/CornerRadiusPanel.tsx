/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/CornerRadiusPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { COLOR_PANEL_WIDTH, INPUT_NO_SPIN } from '@recombyn-native/components/base/colorPanel';
import { Icon } from '@recombyn-native/components/base/icon';
import Slider from '@recombyn-native/components/base/slider';
import { StylePanelShell } from '@recombyn-native/components/editor/panels/StylePanelChrome';
import { cn } from '@recombyn-native/utils/classnames';
import { useTranslation } from 'react-i18next';
import { MAX_EDITABLE_CORNER_VERTICES } from '@recombyn-native/components/rcb/scene/document/sceneRadii';

export type CornerRadiiValue = {
  tl: number;
  tr: number;
  br: number;
  bl: number;
  linked: boolean;
  /** Per-vertex radii when the shape has ≠4 corners. */
  vertices?: number[];
};

const CORNER_ICON: Record<'tl' | 'tr' | 'br' | 'bl', string> = {
  tl: 'editor-corner-tl',
  tr: 'editor-corner-tr',
  br: 'editor-corner-br',
  bl: 'editor-corner-bl',
};

function ensureVertices(value: CornerRadiiValue, count: number): number[] {
  const fromVal = value.vertices;
  if (fromVal && fromVal.length === count) {
    return fromVal.map((v) => Math.max(0, Math.round(v || 0)));
  }
  if (fromVal && fromVal.length) {
    return Array.from({ length: count }, (_, i) =>
      Math.max(0, Math.round(fromVal[i] ?? fromVal[fromVal.length - 1] ?? 0))
    );
  }
  if (count === 4) {
    return [value.tl, value.tr, value.br, value.bl].map((v) =>
      Math.max(0, Math.round(v || 0))
    );
  }
  const u = Math.round((value.tl + value.tr + value.br + value.bl) / 4) || value.tl || 0;
  return Array.from({ length: count }, () => u);
}

/**
 * Dedicated corner-radius panel (not nested under stroke).
 * Rect: 4 corner inputs. Multi-corner path/polygon: one control per vertex.
 */
function CornerRadiusPanel({
  value,
  onChange,
  title = '圆角',
  onClose,
  max = 999,
  vertexCount = 4,
  className,
}: {
  value: CornerRadiiValue;
  onChange: (next: CornerRadiiValue) => void;
  title?: string;
  onClose?: () => void;
  max?: number;
  /** Fillet-able corners on the selected shape (4 for rect). */
  vertexCount?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
  const n = Math.max(1, Math.round(vertexCount) || 4);
  const multi = n !== 4;
  const editablePerVertex = multi && n <= MAX_EDITABLE_CORNER_VERTICES;
  const vertices = ensureVertices(value, n);
  const uniform =
    Math.round(vertices.reduce((a, b) => a + b, 0) / Math.max(1, vertices.length)) ||
    value.tl ||
    0;

  const emit = (next: { linked: boolean; vertices: number[] }) => {
    const vs = next.vertices.map(clamp);
    onChange({
      tl: vs[0] ?? 0,
      tr: vs[1] ?? vs[0] ?? 0,
      br: vs[2] ?? vs[0] ?? 0,
      bl: vs[3] ?? vs[0] ?? 0,
      linked: next.linked,
      vertices: vs,
    });
  };

  const setUniform = (raw: number) => {
    const v = clamp(raw);
    emit({ linked: true, vertices: Array.from({ length: n }, () => v) });
  };

  const setCorner = (key: 'tl' | 'tr' | 'br' | 'bl', raw: number) => {
    const v = clamp(raw);
    if (value.linked) {
      setUniform(v);
      return;
    }
    const idx = key === 'tl' ? 0 : key === 'tr' ? 1 : key === 'br' ? 2 : 3;
    const vs = ensureVertices(value, 4).slice();
    vs[idx] = v;
    emit({ linked: false, vertices: vs });
  };

  const setVertex = (index: number, raw: number) => {
    const v = clamp(raw);
    if (value.linked) {
      setUniform(v);
      return;
    }
    const vs = vertices.slice();
    vs[index] = v;
    emit({ linked: false, vertices: vs });
  };

  const cells: Array<{ key: 'tl' | 'tr' | 'bl' | 'br'; tip: string; iconEnd?: boolean }> = [
    { key: 'tl', tip: t('editor.cornerRadiusTL'), iconEnd: true },
    { key: 'tr', tip: t('editor.cornerRadiusTR') },
    { key: 'bl', tip: t('editor.cornerRadiusBL'), iconEnd: true },
    { key: 'br', tip: t('editor.cornerRadiusBR') },
  ];

  const linkLabel = value.linked
    ? multi
      ? t('editor.cornerRadiusUnlockAll', { defaultValue: '解锁各角' })
      : t('editor.cornerRadiusUnlock', { defaultValue: '解锁四角' })
    : multi
      ? t('editor.cornerRadiusLockAll', { defaultValue: '锁定各角' })
      : t('editor.cornerRadiusLock', { defaultValue: '锁定四角' });

  return (
    <StylePanelShell
      title={title}
      onClose={onClose}
      width={COLOR_PANEL_WIDTH}
      dataAttr="data-radius-panel"
      className={className}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-[12px] text-[var(--muted)]">R</span>
        <div className="min-w-0 flex-1">
          <Slider
            min={0}
            max={max}
            step={1}
            value={Math.min(max, Math.max(0, uniform))}
            onChange={setUniform}
          />
        </div>
        <input
          type="number"
          min={0}
          max={max}
          aria-label={title}
          value={uniform}
          onChange={(e) => setUniform(Number(e.target.value))}
          className={cn(
            'h-7 w-12 shrink-0 rounded-xl bg-[var(--accent-soft)] px-1.5 text-center text-[12px] tabular-nums outline-none',
            INPUT_NO_SPIN
          )}
        />
        {editablePerVertex || !multi ? (
          <button
            type="button"
            aria-label={linkLabel}
            aria-pressed={value.linked}
            title={linkLabel}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-colors',
              value.linked
                ? 'bg-[var(--surface)] text-[var(--accent)] ring-1 ring-[var(--line)]'
                : 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]'
            )}
            onClick={() => {
              if (!value.linked) {
                setUniform(uniform);
                return;
              }
              emit({ linked: false, vertices });
            }}
          >
            {value.linked ? (
              <Icon name="editor-link" className="h-4 w-4" />
            ) : (
              <Icon name="editor-unlink" className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>

      {multi && !editablePerVertex ? (
        <div className="text-[11px] text-[var(--muted)]">
          {n} {t('editor.cornerRadiusVertexCount', { defaultValue: '个角' })}
          {` · ${t('editor.cornerRadiusUniformOnly', { defaultValue: '顶点较多，仅支持统一圆角' })}`}
        </div>
      ) : null}

      {/* Rect: always show 4 corners (link = edit-one-updates-all). */}
      {!multi ? (
        <div className="grid w-full grid-cols-2 gap-1.5">
          {cells.map(({ key, tip, iconEnd }) => (
            <label
              key={key}
              title={tip}
              className={cn(
                'flex h-8 min-w-0 items-center gap-1 rounded-xl bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)]',
                iconEnd ? 'justify-between' : 'flex-row-reverse justify-between'
              )}
            >
              <input
                type="number"
                min={0}
                max={max}
                aria-label={tip}
                value={Math.round(value[key] || 0)}
                onChange={(e) => setCorner(key, Number(e.target.value))}
                className={cn(
                  'min-w-0 flex-1 bg-transparent text-[12px] tabular-nums outline-none',
                  iconEnd ? 'text-left' : 'text-right',
                  INPUT_NO_SPIN
                )}
              />
              <Icon name={CORNER_ICON[key]} className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            </label>
          ))}
        </div>
      ) : null}

      {/* Multi-corner path/polygon: always list each vertex (same as rect). */}
      {editablePerVertex ? (
        <div className="grid max-h-48 w-full grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
          {vertices.map((v, i) => {
            const tip = t('editor.cornerRadiusVertex', {
              defaultValue: '角 {{n}}',
              n: i + 1,
            });
            return (
              <label
                key={`v-${i}`}
                title={tip}
                className="flex h-8 min-w-0 items-center gap-1.5 rounded-xl bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)]"
              >
                <span className="w-5 shrink-0 tabular-nums text-[11px] text-[var(--muted)]">
                  {i + 1}
                </span>
                <input
                  type="number"
                  min={0}
                  max={max}
                  aria-label={tip}
                  value={Math.round(v || 0)}
                  onChange={(e) => setVertex(i, Number(e.target.value))}
                  className={cn(
                    'min-w-0 flex-1 bg-transparent text-left text-[12px] tabular-nums outline-none',
                    INPUT_NO_SPIN
                  )}
                />
              </label>
            );
          })}
        </div>
      ) : null}
    </StylePanelShell>
  );
}

export default memo(CornerRadiusPanel);
const MemoizedCornerRadiusPanel = memo(CornerRadiusPanel);
export { MemoizedCornerRadiusPanel as CornerRadiusPanel };
