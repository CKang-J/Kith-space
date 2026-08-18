/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/MultiSelectionToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineLink, HiOutlineLinkSlash } from 'react-icons/hi2';
import { Icon, message, DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
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
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  addNodeToDocument,
  removeNodesFromDocument
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  createShapeNode
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  groupNodesInDocument,
  selectionSharedGroupId,
  ungroupNodesInDocument,
  unlockedGroupableIds,
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  resolveSelectionNodeIds
} from '@recombyn-native/components/rcb/scene/document/sceneClipboard';
import {
  supportsAspectPresets,
  supportsCornerRadius,
  supportsFill,
  supportsStroke,
  supportsBooleanOp
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  openShapeStylePanel,
  patchDocumentNodes,
  setDocument,
  setMixedSelection,
  setSelectedNodeId,
  setSelectedNodeIds,
} from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import {
  SEL_ICON_BTN,
  SEL_ICON_BTN_ACTIVE,
  SEL_SIZE_INPUT,
  SEL_TOOL_BTN,
} from './ToolbarValueSlider';
import { FillColorSwatch, StrokeColorSwatch } from './StyleToolbarIcons';
import BlendModeControl from './BlendModeControl';
import { SelectionToolbarShell } from './SelectionToolbarShell';
import { canvasToolbarChatTargets, SendToChatToolbarAction } from './SendToChatToolbarAction';
import AspectRatioPresetMenu, {
  ELEMENT_ASPECT_PRESETS,
} from './AspectRatioPresetMenu';
import {
  matchAspectPresetKey,
  sizeFromAspectPreset,
} from '../resizeGeometry';
import { radiiFromAttrs } from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  computeShapeBoolean,
  applyBooleanResultPaint,
  type BoolMode,
} from '../shapeBoolean';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

const ASPECT_ORIG_W = 'aspect-original-width';
const ASPECT_ORIG_H = 'aspect-original-height';

/** Match SelectionFeature: images default locked; others free unless attrs say so. */
function readNodeAspectLocked(node: SceneNodeInput): boolean {
  const raw = node?.attrs?.lockAspect;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return node?.key === 'image';
}

/** Multi-select lock: on when selection includes images (unless any unlocked). */
function readMultiAspectLocked(document: SceneDocument, nodeIds: string[]): boolean {
  const nodes = nodeIds.map((id) => document?.deltaSetLike?.[id]).filter(Boolean);
  if (!nodes.length) return false;
  const hasExplicitUnlock = nodes.some((n) => {
    const raw = n?.attrs?.lockAspect;
    return raw === false || raw === 'false' || raw === 0 || raw === '0';
  });
  if (!hasExplicitUnlock && nodes.some((n) => n.key === 'image')) return true;
  return nodes.every((n) => readNodeAspectLocked(n));
}

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  document: SceneDocument;
  nodeIds: string[];
  /** Co-selected artboards — group/ungroup expand to content inside them. */
  frameIds?: string[];
  box: SceneBox;
};

const btn = SEL_TOOL_BTN;
const iconBtn = SEL_ICON_BTN;

function Sep() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />;
}

type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom';

type GeomPatch = {
  nodeId: string;
  patch: { x?: number; y?: number; width?: number; height?: number; attrs?: Record<string, unknown> };
};

type NodeBox = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  shapeType: string;
  fill: string;
  stroke: string;
  borderWidth: number;
  path?: string;
  angle?: number;
  sides?: number;
  attrs?: Record<string, unknown>;
};

function readBoxes(document: SceneDocument, nodeIds: string[]): NodeBox[] {
  return nodeIds
    .map((id) => {
      const node = document?.deltaSetLike?.[id];
      if (!node) return null;
      const { left, top } = nodeLeftTop(document, node);
      const pathRaw = node.attrs?.path != null ? String(node.attrs.path) : '';
      const angle = Number(node.attrs?.angle ?? 0) || 0;
      const sidesRaw = Number(node.attrs?.sides);
      return {
        id,
        left,
        top,
        width: Math.max(1, Number(node.width) || 1),
        height: Math.max(1, Number(node.height) || 1),
        shapeType: String(node.attrs?.shapeType || (node.key === 'shape' ? 'rect' : node.key || '')),
        fill: String(node.attrs?.['fill-color'] || '#FFFFFF'),
        stroke: String(node.attrs?.['border-color'] || '#333333'),
        borderWidth: Number(node.attrs?.['border-width'] ?? 1) || 1,
        path: pathRaw || undefined,
        angle,
        sides: Number.isFinite(sidesRaw) ? sidesRaw : undefined,
        // Keep radii / star / ellipse params so boolean samples the painted silhouette.
        attrs: node.attrs && typeof node.attrs === 'object' ? { ...node.attrs } : undefined,
      };
    })
    .filter(Boolean) as NodeBox[];
}

/** `assets/svg/editor/*.svg` → `<Icon name="editor-…" />` */
const ALIGN_ITEMS: Array<{ mode: AlignMode; tip: string; icon: string }> = [
  { mode: 'left', tip: '左对齐', icon: 'editor-align-left' },
  { mode: 'centerX', tip: '水平居中', icon: 'editor-align-center-x' },
  { mode: 'right', tip: '右对齐', icon: 'editor-align-right' },
  { mode: 'top', tip: '顶部对齐', icon: 'editor-align-top' },
  { mode: 'middle', tip: '垂直居中', icon: 'editor-align-middle' },
  { mode: 'bottom', tip: '底部对齐', icon: 'editor-align-bottom' },
];

const BOOL_ITEMS: Array<{ mode: BoolMode; tip: string; icon: string }> = [
  { mode: 'union', tip: '并集 (Ctrl + Alt + U)', icon: 'editor-bool-union' },
  { mode: 'subtract', tip: '减去', icon: 'editor-bool-subtract' },
  { mode: 'intersect', tip: '相交', icon: 'editor-bool-intersect' },
  { mode: 'exclude', tip: '排除', icon: 'editor-bool-exclude' },
];

const STYLE_SUPPORT = {
  fill: supportsFill,
  stroke: supportsStroke,
  radius: supportsCornerRadius,
} as const;

function toolbarIconBtn(
  tip: string,
  opts: {
    key?: string;
    onClick: () => void;
    active?: boolean;
    children: ReactNode;
    className?: string;
    expanded?: boolean;
  }
) {
  return (
    <Tooltip key={opts.key} tip={tip} placement="top">
      <button
        type="button"
        aria-label={tip}
        aria-expanded={opts.expanded}
        className={cn(iconBtn, opts.active && SEL_ICON_BTN_ACTIVE, opts.className)}
        onClick={opts.onClick}
      >
        {opts.children}
      </button>
    </Tooltip>
  );
}

function joinToolbarSections(parts: ReactNode[]) {
  const shown = parts.filter(Boolean);
  return shown.map((section, i) => (
    <div key={i} className="contents">
      {i > 0 ? <Sep /> : null}
      {section}
    </div>
  ));
}

function alignPatches(boxes: NodeBox[], mode: AlignMode): GeomPatch[] {
  if (boxes.length < 2) return [];
  const minL = Math.min(...boxes.map((b) => b.left));
  const maxR = Math.max(...boxes.map((b) => b.left + b.width));
  const minT = Math.min(...boxes.map((b) => b.top));
  const maxB = Math.max(...boxes.map((b) => b.top + b.height));
  const midX = (minL + maxR) / 2;
  const midY = (minT + maxB) / 2;
  return boxes.map((b) => {
    switch (mode) {
      case 'left':
        return { nodeId: b.id, patch: { x: minL } };
      case 'centerX':
        return { nodeId: b.id, patch: { x: midX - b.width / 2 } };
      case 'right':
        return { nodeId: b.id, patch: { x: maxR - b.width } };
      case 'top':
        return { nodeId: b.id, patch: { y: minT } };
      case 'middle':
        return { nodeId: b.id, patch: { y: midY - b.height / 2 } };
      case 'bottom':
        return { nodeId: b.id, patch: { y: maxB - b.height } };
      default:
        return { nodeId: b.id, patch: {} };
    }
  });
}

/** Even gaps along one axis; first/last stay put. */
function distributePatches(boxes: NodeBox[], axis: 'h' | 'v'): GeomPatch[] {
  if (boxes.length < 3) return [];
  const horizontal = axis === 'h';
  const sorted = [...boxes].sort((a, b) =>
    horizontal ? a.left - b.left : a.top - b.top
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSize = sorted.reduce((s, b) => s + (horizontal ? b.width : b.height), 0);
  const span = horizontal
    ? last.left + last.width - first.left - totalSize
    : last.top + last.height - first.top - totalSize;
  const gap = span / (sorted.length - 1);
  let cursor = horizontal ? first.left : first.top;
  const out: GeomPatch[] = [];
  sorted.forEach((b, i) => {
    if (i === 0) {
      cursor = (horizontal ? b.left + b.width : b.top + b.height) + gap;
      return;
    }
    if (i === sorted.length - 1) return;
    out.push({
      nodeId: b.id,
      patch: horizontal ? { x: cursor } : { y: cursor },
    });
    cursor += (horizontal ? b.width : b.height) + gap;
  });
  return out;
}

function scaleBoxesAroundCenter(
  boxes: NodeBox[],
  union: SceneBox,
  sx: number,
  sy: number
): GeomPatch[] {
  const cx = union.left + union.width / 2;
  const cy = union.top + union.height / 2;
  return boxes.map((b) => {
    const ncx = b.left + b.width / 2;
    const ncy = b.top + b.height / 2;
    const nw = Math.max(1, Math.round(b.width * sx));
    const nh = Math.max(1, Math.round(b.height * sy));
    return {
      nodeId: b.id,
      patch: {
        x: Math.round(cx + (ncx - cx) * sx - nw / 2),
        y: Math.round(cy + (ncy - cy) * sy - nh / 2),
        width: nw,
        height: nh,
      },
    };
  });
}

/** Multi-select floating bar: align inline; distribute / boolean in menus. */
function MultiSelectionToolbar({
  document,
  nodeIds,
  frameIds = [],
  box,
}: Props): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [booleanOpen, setBooleanOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);

  /** Explicit nodes ∪ content inside co-selected artboards. */
  const opNodeIds = useMemo(
    () => resolveSelectionNodeIds(document, nodeIds, frameIds),
    [document, nodeIds, frameIds]
  );

  const boxes = useMemo(() => readBoxes(document, opNodeIds), [document, opNodeIds]);
  const aspectLocked = useMemo(
    () => readMultiAspectLocked(document, opNodeIds),
    [document, opNodeIds]
  );

  const shapeBoxes = useMemo(
    () =>
      boxes.filter((b) => {
        const node = document?.deltaSetLike?.[b.id];
        return supportsBooleanOp(node);
      }),
    [boxes, document]
  );

  const allSupport = (pred: (node: SceneNodeInput) => boolean) =>
    opNodeIds.length > 0 &&
    opNodeIds.every((id) => pred(document?.deltaSetLike?.[id]));

  const showBoolean = shapeBoxes.length >= 2 && allSupport(supportsBooleanOp);
  const showStroke = allSupport(supportsStroke);
  const showFill = allSupport(supportsFill);
  const showCornerRadius = allSupport(supportsCornerRadius);
  const showAspectPresets = allSupport(supportsAspectPresets);
  const canAlign = boxes.length >= 2;
  const canDistribute = boxes.length >= 3;

  const activeRatioId = useMemo(
    () => matchAspectPresetKey(box.width, box.height, ELEMENT_ASPECT_PRESETS),
    [box.width, box.height]
  );

  const applyPatches = (patches: GeomPatch[]) => {
    if (!patches.length) return;
    dispatch(patchDocumentNodes({ patches }));
  };

  const align = (mode: AlignMode) => {
    applyPatches(alignPatches(boxes, mode));
  };

  const distribute = (axis: 'h' | 'v') => {
    if (boxes.length < 3) {
      message.warning('至少选中 3 个元素才能分布');
      return;
    }
    applyPatches(distributePatches(boxes, axis));
    setDistributeOpen(false);
  };

  const runBoolean = (mode: BoolMode) => {
    if (shapeBoxes.length < 2) {
      message.warning('布尔运算需至少 2 个形状');
      return;
    }

    const ids = shapeBoxes.map((b) => b.id);
    const { result, usedFallback, hasNonRect } = computeShapeBoolean(shapeBoxes, mode);

    if (!result) {
      if (mode === 'intersect') {
        message.warning('没有重叠区域');
      } else if (mode === 'subtract') {
        message.warning('相减后没有剩余图形');
      } else {
        message.warning('布尔运算失败');
      }
      return;
    }

    if (usedFallback && hasNonRect) {
      message.warning('已使用包围盒近似；部分形状轮廓未能精确计算');
    }

    const sample = shapeBoxes[0];
    const sampleNode = document?.deltaSetLike?.[sample.id];
    const { id, node } = createShapeNode({
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
      shapeType: 'path',
      fill: sample.fill,
      stroke: sample.stroke,
      borderWidth: sample.borderWidth,
      path: result.path,
      closed: true,
    });
    const attrs = node.attrs as Record<string, unknown>;
    attrs['fill-rule'] = result.fillRule;
    attrs.closed = 'true';
    applyBooleanResultPaint(
      attrs,
      sampleNode?.attrs as Record<string, unknown> | undefined,
      { stroke: sample.stroke, borderWidth: sample.borderWidth }
    );

    let next = addNodeToDocument(document, id, node);
    next = removeNodesFromDocument(next, ids);
    dispatch(setDocument(next));
    dispatch(setSelectedNodeIds([id]));
    dispatch(setSelectedNodeId(id));
    setDistributeOpen(false);
    setBooleanOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
      if (e.key.toLowerCase() !== 'u') return;
      e.preventDefault();
      runBoolean('union');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, shapeBoxes]);

  useEffect(() => {
    if (!distributeOpen && !booleanOpen) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-multi-toolbar-menu]')) return;
      setDistributeOpen(false);
      setBooleanOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [distributeOpen, booleanOpen]);

  const openStyle = (kind: keyof typeof STYLE_SUPPORT) => {
    const ids = opNodeIds.filter((id) => STYLE_SUPPORT[kind](document?.deltaSetLike?.[id]));
    if (!ids.length) return;
    dispatch(openShapeStylePanel({ kind, nodeIds: ids }));
  };

  const toggleAspectLock = () => {
    const next = aspectLocked ? 'false' : 'true';
    applyPatches(
      opNodeIds.map((id) => {
        const shapeType = document?.deltaSetLike?.[id]?.attrs?.shapeType;
        return {
          nodeId: id,
          patch: {
            attrs: {
              ...(shapeType != null ? { shapeType } : {}),
              lockAspect: next,
            },
          },
        };
      })
    );
  };

  const setSize = (axis: 'w' | 'h', raw: string) => {
    if (!box) return;
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    const n = Math.round(Number(trimmed));
    if (!Number.isFinite(n) || n < 1) return;
    // Toolbar shows Math.round(chrome); blur with the same digits must be a no-op
    // (otherwise sx = round(w)/w quietly shrinks/grows the path).
    if (axis === 'w' && n === Math.round(box.width)) return;
    if (axis === 'h' && n === Math.round(box.height)) return;
    const oldW = Math.max(1, box.width);
    const oldH = Math.max(1, box.height);
    let newW = oldW;
    let newH = oldH;
    if (aspectLocked) {
      const ratio = oldW / oldH;
      if (axis === 'w') {
        newW = n;
        newH = Math.max(1, Math.round(n / ratio));
      } else {
        newH = n;
        newW = Math.max(1, Math.round(n * ratio));
      }
    } else if (axis === 'w') {
      newW = n;
    } else {
      newH = n;
    }
    applyPatches(scaleBoxesAroundCenter(boxes, box, newW / oldW, newH / oldH));
  };

  if (!boxes.length || !box) return null;

  const fillSourceId =
    opNodeIds.find((id) => supportsFill(document?.deltaSetLike?.[id])) || opNodeIds[0];
  const firstAttrs = document?.deltaSetLike?.[fillSourceId]?.attrs || {};
  const fillSample: FillPanelValue = {
    fillType: parseFillType(firstAttrs['fill-type']),
    fillColor: String(firstAttrs['fill-color'] || '#FFFFFF'),
    fillOpacity: Number(firstAttrs['fill-opacity'] ?? 100),
    fillGradient:
      firstAttrs['fill-gradient'] != null ? String(firstAttrs['fill-gradient']) : undefined,
    ...fillImageFieldsFromAttrs(firstAttrs),
  };
  const fillVisible = opNodeIds
    .filter((id) => supportsFill(document?.deltaSetLike?.[id]))
    .every((id) => {
      const a = document?.deltaSetLike?.[id]?.attrs || {};
      return boolEffectAttr(a['fill-enabled'], true) && boolEffectAttr(a['fill-visible'], true);
    });
  const fillPreview = fillVisible ? fillPanelPreview(fillSample) : 'transparent';
  const strokeVisible = opNodeIds.every((id) => {
    const a = document?.deltaSetLike?.[id]?.attrs || {};
    return (
      boolEffectAttr(a['stroke-enabled'], true) && boolEffectAttr(a['stroke-visible'], true)
    );
  });
  const strokeColor = String(firstAttrs['border-color'] || firstAttrs.stroke || '#333333');
  const radiusSample = radiiFromAttrs(firstAttrs).tl;

  const groupId = selectionSharedGroupId(document, opNodeIds);

  const createGroup = () => {
    const ids = unlockedGroupableIds(document, opNodeIds);
    if (ids.length < 2) return;
    const next = groupNodesInDocument(document, ids);
    dispatch(setDocument(next));
    dispatch(setMixedSelection({ nodeIds: ids, frameIds }));
  };

  const ungroup = () => {
    const ids = unlockedGroupableIds(document, opNodeIds);
    if (!ids.length) return;
    const next = ungroupNodesInDocument(document, ids);
    dispatch(setDocument(next));
    dispatch(setMixedSelection({ nodeIds: ids, frameIds }));
  };

  const applyAspectPreset = (preset: (typeof ELEMENT_ASPECT_PRESETS)[number]) => {
    if (preset.id === 'original') {
      applyPatches(
        boxes.map((b) => {
          const shapeType = document?.deltaSetLike?.[b.id]?.attrs?.shapeType;
          return {
            nodeId: b.id,
            patch: {
              attrs: {
                ...(shapeType != null ? { shapeType } : {}),
                lockAspect: 'false',
              },
            },
          };
        })
      );
      return;
    }
    const unionNext = sizeFromAspectPreset(box, preset.w, preset.h);
    const geom = scaleBoxesAroundCenter(
      boxes,
      box,
      unionNext.width / Math.max(1, box.width),
      unionNext.height / Math.max(1, box.height)
    );
    applyPatches(
      geom.map((p, i) => {
        const b = boxes[i];
        const node = document?.deltaSetLike?.[b.id];
        const hasOrig =
          Number(node?.attrs?.[ASPECT_ORIG_W]) > 0 &&
          Number(node?.attrs?.[ASPECT_ORIG_H]) > 0;
        const shapeType = node?.attrs?.shapeType;
        return {
          nodeId: p.nodeId,
          patch: {
            ...p.patch,
            attrs: {
              ...(shapeType != null ? { shapeType } : {}),
              lockAspect: 'true',
              ...(!hasOrig
                ? {
                    [ASPECT_ORIG_W]: Math.round(b.width),
                    [ASPECT_ORIG_H]: Math.round(b.height),
                  }
                : {}),
            },
          },
        };
      })
    );
  };

  // Selected group: 解除编组 | export
  if (groupId) {
    return (
      <SelectionToolbarShell box={box}>
        <Tooltip tip="解除编组" placement="top">
          <button type="button" className={btn} aria-label="解除编组" onClick={ungroup}>
            <Icon name="editor-ungroup" width={14} height={14} />
            <span>解除编组</span>
          </button>
        </Tooltip>
        <Sep />
        <ExportSelectionPopover nodeIds={opNodeIds} />
        <Sep />
        <SendToChatToolbarAction target={canvasToolbarChatTargets(opNodeIds, frameIds)} />
      </SelectionToolbarShell>
    );
  }

  const styleItems = [
    showFill &&
      toolbarIconBtn('填充', {
        key: 'fill',
        onClick: () => openStyle('fill'),
        className: !fillVisible ? 'opacity-55' : undefined,
        children: <FillColorSwatch color={fillPreview} />,
      }),
    showStroke &&
      toolbarIconBtn('描边', {
        key: 'stroke',
        onClick: () => openStyle('stroke'),
        className: !strokeVisible ? 'opacity-55' : undefined,
        children: (
          <StrokeColorSwatch color={strokeVisible ? strokeColor : 'var(--line)'} />
        ),
      }),
    showCornerRadius && (
      <Tooltip key="radius" tip="圆角" placement="top">
        <button
          type="button"
          aria-label="圆角"
          className={SEL_TOOL_BTN}
          onClick={() => openStyle('radius')}
        >
          <Icon name="editor-corner-radius" width={16} height={16} />
          <span className="tabular-nums">{radiusSample}</span>
        </button>
      </Tooltip>
    ),
  ].filter(Boolean);

  const layoutItems = [
    canAlign && (
      <div
        key="align"
        className="flex flex-nowrap items-center gap-0.5"
        role="group"
        aria-label="对齐"
      >
        {ALIGN_ITEMS.map(({ mode, tip, icon }) =>
          toolbarIconBtn(tip, {
            key: mode,
            onClick: () => align(mode),
            children: <Icon name={icon} width={16} height={16} />,
          })
        )}
      </div>
    ),
    canDistribute && (
      <div key="distribute" className="relative" data-multi-toolbar-menu>
        {toolbarIconBtn('分布', {
          key: 'distribute-btn',
          active: distributeOpen,
          onClick: () => {
            setBooleanOpen(false);
            setDistributeOpen((v) => !v);
          },
          children: <Icon name="editor-distribute" width={16} height={16} />,
        })}
        {distributeOpen && (
          <DropdownPanel className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-[9rem]">
            <DropdownPanelItem onClick={() => distribute('h')}>水平分布</DropdownPanelItem>
            <DropdownPanelItem onClick={() => distribute('v')}>垂直分布</DropdownPanelItem>
          </DropdownPanel>
        )}
      </div>
    ),
  ].filter(Boolean);

  const booleanMenu = showBoolean && (
    <div className="relative" data-multi-toolbar-menu>
      {toolbarIconBtn('布尔运算', {
        active: booleanOpen,
        expanded: booleanOpen,
        onClick: () => {
          setDistributeOpen(false);
          setBooleanOpen((v) => !v);
        },
        children: <Icon name="editor-bool-union" width={16} height={16} />,
      })}
      {booleanOpen && (
        <DropdownPanel className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-[10.5rem]">
          {BOOL_ITEMS.map(({ mode, tip, icon }) => (
            <DropdownPanelItem key={mode} onClick={() => runBoolean(mode)} className="gap-2">
              <Icon name={icon} width={16} height={16} className="text-[var(--ink)]" />
              <span>{tip.replace(/\s*\(.*\)$/, '')}</span>
            </DropdownPanelItem>
          ))}
        </DropdownPanel>
      )}
    </div>
  );

  const sizeField = (axis: 'w' | 'h', value: number) => (
    <label className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[12px] text-[var(--ink)]">
      <span className="text-[var(--muted)]">{axis.toUpperCase()}</span>
      <input
        className={SEL_SIZE_INPUT}
        defaultValue={Math.round(value)}
        key={`${axis}-${Math.round(value)}`}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => setSize(axis, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setSize(axis, (e.target as HTMLInputElement).value);
        }}
      />
    </label>
  );

  const geometryCluster = (
    <>
      {showAspectPresets && (
        <AspectRatioPresetMenu
          open={ratioOpen}
          onOpenChange={setRatioOpen}
          activeId={activeRatioId}
          onPick={applyAspectPreset}
        />
      )}
      {sizeField('w', box.width)}
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
          onClick={toggleAspectLock}
        >
          {aspectLocked ? (
            <HiOutlineLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <HiOutlineLinkSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </Tooltip>
      {sizeField('h', box.height)}
      <BlendModeControl
        blendMode={firstAttrs.blendMode}
        opacity={firstAttrs.opacity}
        allowPassThrough={opNodeIds.every(
          (id) => document?.deltaSetLike?.[id]?.key === 'frame'
        )}
        onBlendModeChange={(mode) => {
          applyPatches(
            opNodeIds.map((id) => ({ nodeId: id, patch: { attrs: { blendMode: mode } } }))
          );
        }}
        onOpacityChange={(opacity) => {
          applyPatches(
            opNodeIds.map((id) => ({ nodeId: id, patch: { attrs: { opacity } } }))
          );
        }}
      />
    </>
  );

  const actionCluster = (
    <>
      {opNodeIds.length >= 2 && (
        <Tooltip tip="创建编组" placement="top">
          <button type="button" className={btn} aria-label="创建编组" onClick={createGroup}>
            <Icon name="editor-group" width={14} height={14} />
            <span>创建编组</span>
          </button>
        </Tooltip>
      )}
      <ExportSelectionPopover nodeIds={opNodeIds} />
      <SendToChatToolbarAction target={canvasToolbarChatTargets(opNodeIds, frameIds)} />
    </>
  );

  return (
    <SelectionToolbarShell box={box}>
      {joinToolbarSections([
        styleItems.length ? <>{styleItems}</> : null,
        layoutItems.length ? (
          <div className="flex flex-nowrap items-center gap-0.5">{layoutItems}</div>
        ) : null,
        booleanMenu,
        geometryCluster,
        actionCluster,
      ])}
    </SelectionToolbarShell>
  );
}

export default memo(MultiSelectionToolbar);
