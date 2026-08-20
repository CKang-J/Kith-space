/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/ShapeSelectionToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, useState, useSyncExternalStore, memo } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  fillPanelPreview,
  type FillPanelValue,
} from '@recombyn-native/components/editor/panels/FillPanel';
import { ExportSelectionPopover } from '@recombyn-native/components/editor/panels/ExportSelectionPanel';
import {
  fillImageFieldsFromAttrs,
  parseFillType,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
import { boolEffectAttr } from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { openShapeStylePanel, patchDocumentNode } from '@recombyn-native/store/modules/editor';
import ToolbarValueSlider, {
  SEL_ICON_BTN,
  SEL_SIZE_INPUT,
  SEL_TOOL_BTN,
} from '@recombyn-native/components/rcb/selection/chrome/ToolbarValueSlider';
import {
  FillColorSwatch,
  IconCornerRadius,
  StrokeColorSwatch,
} from '@recombyn-native/components/rcb/selection/chrome/StyleToolbarIcons';
import AspectRatioPresetMenu, {
  ELEMENT_ASPECT_PRESETS,
} from '@recombyn-native/components/rcb/selection/chrome/AspectRatioPresetMenu';
import {
  matchAspectPresetKey,
  sizeFromAspectPreset,
} from '@recombyn-native/components/rcb/selection/resizeGeometry';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { Icon } from '@recombyn-native/components/base/icon';
import { cn } from '@recombyn-native/utils/classnames';
import {
  supportsAspectPresets,
  supportsCornerRadius,
  supportsFill,
  supportsShapeSides,
  supportsStroke
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  cornerRadiusToolbarDisplay,
  getLiveCornerRadiusPreview,
  subscribeLiveCornerRadiusPreview,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  clampShapeSides,
  DEFAULT_SHAPE_SIDES,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_SIDES,
  sidesFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import {
  buildOutlinePathAsync,
  canOutlineNode,
  outlineNodePatch,
  requestEnterPathEdit,
} from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import { TbVectorBezier } from 'react-icons/tb';
import { message } from '@recombyn-native/components/base';
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

function readAspectLocked(attrs: Record<string, unknown> | undefined): boolean {
  const raw = attrs?.lockAspect;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return false;
}

/** Compact toolbar R: linked → any corner; unlinked → max so mixed corners stay visible. */
function toolbarCornerRadius(attrs: Record<string, unknown> | undefined): number {
  return cornerRadiusToolbarDisplay(attrs);
}

type SceneBox = { left: number; top: number; width: number; height: number };

/** Stored before first ratio preset so 「自由」 can restore. */
const ASPECT_ORIG_W = 'aspect-original-width';
const ASPECT_ORIG_H = 'aspect-original-height';

/** Single-shape floating bar: fill / stroke · corner radius · W·H · ratio · download. */
function ShapeSelectionToolbar({
  nodeId,
  node,
  box,
  hideExport = false,
}: {
  nodeId: string;
  node: SceneNodeInput;
  box: SceneBox;
  /** When true, parent renders Export after blend (unified toolbar order). */
  hideExport?: boolean;
}) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [ratioOpen, setRatioOpen] = useState(false);
  const cornerRadius = supportsCornerRadius(node);
  const canFill = supportsFill(node);
  const canStroke = supportsStroke(node);
  const showAspectPresets = supportsAspectPresets(node);
  const showSides = supportsShapeSides(node);
  const shapeType = String(node?.attrs?.shapeType || '');
  const sidesLabel = shapeType === 'star' ? '角数' : '边数';
  const sidesPrefix = shapeType === 'star' ? '角' : '边';
  const sides = sidesFromAttrs(node?.attrs);
  const aspectLocked = readAspectLocked(node?.attrs);

  const activeRatioId = useMemo(
    () => matchAspectPresetKey(box.width, box.height, ELEMENT_ASPECT_PRESETS),
    [box.width, box.height]
  );

  const fillValue: FillPanelValue = {
    fillType: parseFillType(node?.attrs?.['fill-type']),
    fillColor: String(node?.attrs?.['fill-color'] || '#FFFFFF'),
    fillOpacity: Number(node?.attrs?.['fill-opacity'] ?? 100),
    fillGradient:
      node?.attrs?.['fill-gradient'] != null ? String(node.attrs['fill-gradient']) : undefined,
    ...fillImageFieldsFromAttrs(node?.attrs),
  };
  const fillVisible =
    boolEffectAttr(node?.attrs?.['fill-enabled'], true) &&
    boolEffectAttr(node?.attrs?.['fill-visible'], true);
  const fillPreview = fillVisible ? fillPanelPreview(fillValue) : 'transparent';
  const strokeVisible =
    boolEffectAttr(node?.attrs?.['stroke-enabled'], true) &&
    boolEffectAttr(node?.attrs?.['stroke-visible'], true);
  const strokeColor = String(node?.attrs?.['border-color'] || node?.attrs?.stroke || '#333333');
  const liveCornerRadius = useSyncExternalStore(
    subscribeLiveCornerRadiusPreview,
    () => getLiveCornerRadiusPreview(nodeId),
    () => null
  );
  const radius = liveCornerRadius ?? toolbarCornerRadius(node?.attrs);

  const patchAttrs = (attrs: Record<string, unknown>) => {
    const shapeType = node?.attrs?.shapeType;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            ...(shapeType != null ? { shapeType } : {}),
            ...attrs,
          },
        },
      })
    );
  };

  const patchSize = (width: number, height: number) => {
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        },
      })
    );
  };

  const setSize = (axis: 'w' | 'h', raw: string) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    const n = Math.round(Number(trimmed));
    if (!Number.isFinite(n) || n < 1) return;
    if (axis === 'w' && n === Math.round(box.width)) return;
    if (axis === 'h' && n === Math.round(box.height)) return;
    if (aspectLocked) {
      const ratio = box.width / Math.max(1, box.height);
      if (axis === 'w') patchSize(n, Math.max(1, Math.round(n / ratio)));
      else patchSize(Math.max(1, Math.round(n * ratio)), n);
      return;
    }
    if (axis === 'w') patchSize(n, Math.round(box.height));
    else patchSize(Math.round(box.width), n);
  };

  const applySides = (n: number) => {
    patchAttrs({ sides: clampShapeSides(n, DEFAULT_SHAPE_SIDES) });
  };

  const applyAspectPreset = (preset: (typeof ELEMENT_ASPECT_PRESETS)[number]) => {
    if (preset.id === 'original') {
      // 「自由」：保持当前尺寸，取消比例锁定
      patchAttrs({ lockAspect: 'false' });
      return;
    }
    const shapeType = node?.attrs?.shapeType;
    const hasOrig =
      Number(node?.attrs?.[ASPECT_ORIG_W]) > 0 && Number(node?.attrs?.[ASPECT_ORIG_H]) > 0;
    const next = sizeFromAspectPreset(box, preset.w, preset.h);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: Math.max(1, Math.round(next.width)),
          height: Math.max(1, Math.round(next.height)),
          attrs: {
            ...(shapeType != null ? { shapeType } : {}),
            lockAspect: 'true',
            ...(!hasOrig
              ? {
                  [ASPECT_ORIG_W]: Math.round(box.width),
                  [ASPECT_ORIG_H]: Math.round(box.height),
                }
              : {}),
          },
        },
      })
    );
  };

  const applyOutline = async () => {
    const hide = message.loading('轮廓化中…', 0);
    try {
      const outline = await buildOutlinePathAsync(node);
      if (!outline?.pathD) {
        message.error('轮廓化失败');
        return;
      }
      const patch = outlineNodePatch(node, outline);
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            key: 'shape',
            x: patch.x,
            y: patch.y,
            width: patch.width,
            height: patch.height,
            attrs: patch.attrs,
          },
        })
      );
      requestEnterPathEdit(nodeId, outline.pathD);
      message.success('已轮廓化');
    } finally {
      hide();
    }
  };

  const openStyle = (kind: 'fill' | 'stroke' | 'radius') => {
    dispatch(openShapeStylePanel({ kind, nodeIds: [nodeId] }));
  };

  const showOutline = canOutlineNode(node);

  return (
    <>
      {canFill ? (
        <Tooltip tip={'颜色'} placement="top">
          <button
            type="button"
            aria-label={'颜色'}
            className={cn(SEL_ICON_BTN, !fillVisible && 'opacity-55')}
            onClick={() => openStyle('fill')}
          >
            <FillColorSwatch color={fillPreview} />
          </button>
        </Tooltip>
      ) : null}

      {canStroke ? (
        <Tooltip tip={'描边'} placement="top">
          <button
            type="button"
            aria-label={'描边'}
            className={cn(SEL_ICON_BTN, !strokeVisible && 'opacity-55')}
            onClick={() => openStyle('stroke')}
          >
            <StrokeColorSwatch color={strokeVisible ? strokeColor : 'var(--line)'} />
          </button>
        </Tooltip>
      ) : null}
      {cornerRadius ? (
        <Tooltip tip={'圆角'} placement="top">
          <button
            type="button"
            aria-label={'圆角'}
            className={SEL_TOOL_BTN}
            onClick={() => openStyle('radius')}
          >
            <IconCornerRadius className="h-4 w-4 text-[var(--muted)]" />
            <span className="tabular-nums">{radius}</span>
          </button>
        </Tooltip>
      ) : null}

      {showSides ? (
        <ToolbarValueSlider
          prefix={sidesPrefix}
          value={sides}
          min={MIN_SHAPE_SIDES}
          max={MAX_SHAPE_SIDES}
          onChange={applySides}
          title={sidesLabel}
          panelLabel={sidesLabel}
        />
      ) : null}

      {showAspectPresets ? (
        <AspectRatioPresetMenu
          open={ratioOpen}
          onOpenChange={setRatioOpen}
          activeId={activeRatioId}
          onPick={applyAspectPreset}
        />
      ) : null}

      <label className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[12px] text-[var(--ink)]">
        <span className="text-[var(--muted)]">W</span>
        <input
          className={SEL_SIZE_INPUT}
          defaultValue={Math.round(box.width)}
          key={`w-${Math.round(box.width)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => setSize('w', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSize('w', (e.target as HTMLInputElement).value);
          }}
        />
      </label>
      <Tooltip
        tip={
          aspectLocked
            ? t('editor.imageToolbar.unlockAspect')
            : t('editor.imageToolbar.lockAspect')
        }
        placement="top"
      >
        <button
          type="button"
          aria-label={
            aspectLocked
              ? t('editor.imageToolbar.unlockAspect')
              : t('editor.imageToolbar.lockAspect')
          }
          aria-pressed={aspectLocked}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
            aspectLocked && 'bg-[var(--accent-soft)] text-[var(--ink)]'
          )}
          onClick={() =>
            patchAttrs({ lockAspect: aspectLocked ? 'false' : 'true' })
          }
        >
          {aspectLocked ? (
            <Icon name="editor-link" width={14} height={14} />
          ) : (
            <Icon name="editor-unlink" width={14} height={14} />
          )}
        </button>
      </Tooltip>
      <label className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[12px] text-[var(--ink)]">
        <span className="text-[var(--muted)]">H</span>
        <input
          className={SEL_SIZE_INPUT}
          defaultValue={Math.round(box.height)}
          key={`h-${Math.round(box.height)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => setSize('h', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSize('h', (e.target as HTMLInputElement).value);
          }}
        />
      </label>

      {showOutline ? (
        <Tooltip tip="Outline" placement="top">
          <button type="button" aria-label="Outline" className={SEL_ICON_BTN} onClick={applyOutline}>
            <TbVectorBezier className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}

      {hideExport ? null : <ExportSelectionPopover nodeIds={[nodeId]} />}
    </>
  );
}

export default memo(ShapeSelectionToolbar);
