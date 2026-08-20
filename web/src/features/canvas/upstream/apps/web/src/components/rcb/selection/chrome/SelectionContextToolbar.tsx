/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/SelectionContextToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBold,
  HiOutlineChevronDown,
  HiOutlineCodeBracket,
  HiOutlineItalic,
  HiOutlineLink,
  HiOutlineLinkSlash,
  HiOutlineSparkles,
  HiOutlineStrikethrough,
  HiOutlineUnderline,
} from 'react-icons/hi2';
import {
  MdFormatAlignCenter,
  MdFormatAlignLeft,
  MdFormatAlignRight,
  MdFormatOverline,
} from 'react-icons/md';
import { ColorPanelPopover } from '@recombyn-native/components/base/colorPanel';
import { DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
import {
  openShapeStylePanel,
  patchDocumentNode,
  startImageProcess,
  openImageToolPanel,
  openVideoToolPanel,
  openAudioToolPanel,
} from '@recombyn-native/store/modules/editor';
import FlipRotateToolbar from '@recombyn-native/components/editor/nodes/ImageNode/FlipRotateToolbar';
import ImageQuickEditComposer from '@recombyn-native/components/editor/nodes/ImageNode/ImageQuickEditComposer';
import LottieQuickEditComposer from '@recombyn-native/components/editor/nodes/LottieNode/LottieQuickEditComposer';
import VideoQuickEditComposer from '@recombyn-native/components/editor/nodes/VideoNode/VideoQuickEditComposer';
import AudioQuickEditComposer from '@recombyn-native/components/editor/nodes/AudioNode/AudioQuickEditComposer';
import LottieToolbarEditTools from '@recombyn-native/components/editor/nodes/LottieNode/LottieToolbarEditTools';
import { ExportSelectionPopover } from '@recombyn-native/components/editor/panels/ExportSelectionPanel';
import { ImageToolSep, imageToolBtn } from '@recombyn-native/components/editor/nodes/ImageNode/imageToolbarShared';
import {
  buildMarkdownTextAttrs,
  buildTextAttrsPreservingMarkdown,
  isTextBold,
  isTextItalic,
  isTextOverline,
  isTextStrike,
  isTextUnderline,
  measurePlainTextSize,
  parseNodeMarkdown,
  parseNodeTextStyle,
  toggleTextDecoration,
} from '@recombyn-native/components/rcb/scene/document/sceneText';
import { markdownToPlain } from '@recombyn-native/components/rcb/scene/document/sceneMarkdown';
import {
  isAudioGeneratorNode,
  isIconImageNode,
  isImageGeneratorNode,
  isLottieGeneratorNode,
  isVideoGeneratorNode,
  supportsCornerRadius,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { type ImageProcessKind } from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import ToolbarMenuSelect from './ToolbarMenuSelect';
import BlendModeControl from './BlendModeControl';
import {
  SEL_ICON_BTN,
  SEL_ICON_BTN_ACTIVE,
  SEL_TOOL_BTN,
} from './ToolbarValueSlider';
import { IconCornerRadius } from './StyleToolbarIcons';
import FontFamilyPicker from '@recombyn-native/components/editor/nodes/TextNode/FontFamilyPicker';
import TextEditDialog from '@recombyn-native/components/editor/nodes/TextNode/TextEditDialog';
import IconAnnotateToolbar from '@recombyn-native/components/editor/nodes/ImageNode/IconAnnotateToolbar';
import ImageToolbarEditTools from '@recombyn-native/components/editor/nodes/ImageNode/ImageToolbarEditTools';
import ImageToolbarMoreDownload from '@recombyn-native/components/editor/nodes/ImageNode/ImageToolbarMoreDownload';
import ImageFullscreenPreviewButton from '@recombyn-native/components/editor/nodes/ImageNode/ImageFullscreenPreviewButton';
import {
  VideoDownloadButton,
  VideoFullscreenPreviewButton,
  VideoToolbarEditTools,
  getVideoHoverHost,
} from '@recombyn-native/components/editor/nodes/VideoNode';
import {
  AudioToolbarEditTools,
  getAudioHost,
} from '@recombyn-native/components/editor/nodes/AudioNode';
import ShapeSelectionToolbar from '@recombyn-native/components/editor/nodes/ShapeNode/ShapeSelectionToolbar';
import { SelectionToolbarShell } from './SelectionToolbarShell';
import { SendToChatToolbarAction } from './SendToChatToolbarAction';
import {
  cornerRadiusToolbarDisplay,
  getLiveCornerRadiusPreview,
  subscribeLiveCornerRadiusPreview,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  buildOutlinePathAsync,
  canOutlineNode,
  outlineNodePatch,
  requestEnterPathEdit,
} from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import {
  loadFontCatalog,
  parseWeightSelectValue,
  resolveWeightSelectValue,
  weightOptionsForFamily,
} from '@recombyn-native/components/rcb/scene/document/fontCatalog';
import { TbVectorBezier } from 'react-icons/tb';
import { message } from '@recombyn-native/components/base';
import { unsupportedImageProcessKindMessage } from '@recombyn-native/service/imageTools';
import { cn } from '@recombyn-native/utils/classnames';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

const SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, 80, 96, 108].map((n) => ({
  value: String(n),
  label: String(n),
}));

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
  /** Scene pad beyond chrome for outer stroke ink (center stroke half-width). */
  edgePadScene?: number;
  onOpenAgent?: (opts?: { prompt?: string }) => void;
};

const btn = SEL_TOOL_BTN;

function Sep() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />;
}

/** Prefer attrs.lockAspect; default locked for image/video. */
function resolveImageAspectLocked(node: SceneNodeInput, kind: string): boolean {
  const raw = node?.attrs?.lockAspect;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return kind === 'image' || kind === 'video' || kind === 'lottie' || kind === 'audio';
}

/** Solid MD glyphs — outline bars-3 reads too light next to B/I/U. */
function AlignIcon({ align }: { align: string }) {
  const cls = 'h-3.5 w-3.5 text-current';
  if (align === 'center') return <MdFormatAlignCenter className={cls} />;
  if (align === 'right') return <MdFormatAlignRight className={cls} />;
  return <MdFormatAlignLeft className={cls} />;
}

function DecorationsTriggerIcon({
  underline,
  overline,
  strike,
}: {
  underline: boolean;
  overline: boolean;
  strike: boolean;
}) {
  const cls = 'h-3.5 w-3.5 text-current';
  if (underline && !overline && !strike) return <HiOutlineUnderline className={cls} strokeWidth={2} />;
  if (overline && !underline && !strike) return <MdFormatOverline className={cls} />;
  if (strike && !underline && !overline) {
    return <HiOutlineStrikethrough className={cls} strokeWidth={2} />;
  }
  return <HiOutlineUnderline className={cls} strokeWidth={2} />;
}

function SelectionContextToolbar(props: Props): ReactNode {
  const { document, nodeId, box, edgePadScene = 0 } = props;
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [decorationOpen, setDecorationOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const imageToolPanel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const node = document?.deltaSetLike?.[nodeId];
  const kind = node?.key || 'shape';
  const flipRotateOpen =
    (kind === 'image' || kind === 'video') &&
    imageToolPanel?.kind === 'flipRotate' &&
    imageToolPanel?.nodeId === nodeId;
  const quickEditOpen =
    imageToolPanel?.kind === 'quickEdit' &&
    imageToolPanel?.nodeId === nodeId &&
    (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'lottie');
  const lottieEditOpen =
    kind === 'lottie' &&
    imageToolPanel?.kind === 'lottieEdit' &&
    imageToolPanel?.nodeId === nodeId;
  // Side panels (Eraser / Opacity / Replace text / …) own the chrome — hide the selection pill.
  const imageSidePanelOpen =
    Boolean(imageToolPanel?.nodeId) &&
    (imageToolPanel?.kind === 'eraser' ||
      imageToolPanel?.kind === 'opacity' ||
      imageToolPanel?.kind === 'replaceText' ||
      imageToolPanel?.kind === 'multiAngle' ||
      imageToolPanel?.kind === 'adjust' ||
      imageToolPanel?.kind === 'mark' ||
      imageToolPanel?.kind === 'upscale' ||
      imageToolPanel?.kind === 'expand' ||
      imageToolPanel?.kind === 'crop');
  const [mdOpen, setMdOpen] = useState(false);
  const [fontCatalogTick, setFontCatalogTick] = useState(0);
  const style = useMemo(
    () => (kind === 'text' ? parseNodeTextStyle(node?.attrs || {}) : null),
    [kind, node?.attrs]
  );
  const liveCornerRadius = useSyncExternalStore(
    subscribeLiveCornerRadiusPreview,
    () => getLiveCornerRadiusPreview(nodeId),
    () => null
  );
  const toolbarCornerRadius =
    liveCornerRadius ?? cornerRadiusToolbarDisplay(node?.attrs);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      await loadFontCatalog();
      if (!cancelled) setFontCatalogTick((n) => n + 1);
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!decorationOpen && !alignOpen) return;
    const onPointer = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-text-toolbar-menu]')) return;
      setDecorationOpen(false);
      setAlignOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [decorationOpen, alignOpen]);

  if (!node || !box) return null;
  // Generator plate uses its own composer overlay — hide photo AI selection chrome.
  if (
    isImageGeneratorNode(node) ||
    isVideoGeneratorNode(node) ||
    isLottieGeneratorNode(node) ||
    isAudioGeneratorNode(node)
  ) {
    return null;
  }
  if (imageSidePanelOpen) return null;

  const patchTextStyle = (partial: Record<string, unknown>) => {
    const next = buildTextAttrsPreservingMarkdown(node.attrs || {}, {
      ...parseNodeTextStyle(node.attrs || {}),
      ...partial,
    } as any);
    dispatch(patchDocumentNode({ nodeId, patch: { attrs: next } }));
  };

  const textAlign = String(style?.textAlign || 'left');
  const fontFamily = String(style?.fontFamily || 'Alibaba PuHuiTi');
  void fontCatalogTick;
  const weightFaces = weightOptionsForFamily(fontFamily);
  const weightSelectOptions = weightFaces.map((o) => ({ value: o.value, label: o.label }));
  const weightSelectValue = resolveWeightSelectValue(fontFamily, style?.fontWeight);
  const weightDisplayLabel =
    weightFaces.find((o) => o.value === weightSelectValue)?.label ||
    weightFaces[0]?.label ||
    'Regular';
  const showWeightSelect = weightFaces.length > 1;
  const showBoldToggle = true;

  const runImageProcess = (
    kind: ImageProcessKind,
    label: string,
    size?: { targetWidth?: number; targetHeight?: number },
    meta?: Record<string, unknown>
  ) => {
    dispatch(
      startImageProcess({
        sourceId: nodeId,
        kind,
        label,
        targetWidth: size?.targetWidth,
        targetHeight: size?.targetHeight,
        meta,
      })
    );
  };

  const showBlend = !(kind === 'image' && isIconImageNode(node));
  const imageAspectLocked = resolveImageAspectLocked(node, kind);
  const blendControl = showBlend ? (
    <BlendModeControl
      blendMode={node?.attrs?.blendMode}
      opacity={node?.attrs?.opacity}
      allowPassThrough={kind === 'frame'}
      onBlendModeChange={(mode) =>
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { blendMode: mode } } }))
      }
      onOpacityChange={(opacity) =>
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { opacity } } }))
      }
      onOpacityOpen={
        kind === 'image'
          ? () => dispatch(openImageToolPanel({ nodeId, kind: 'opacity' }))
          : undefined
      }
    />
  ) : null;

  if (quickEditOpen || lottieEditOpen) {
    if (kind === 'video') {
      return <VideoQuickEditComposer document={document} nodeId={nodeId} box={box} />;
    }
    if (kind === 'audio') {
      return <AudioQuickEditComposer document={document} nodeId={nodeId} box={box} />;
    }
    if (kind === 'lottie') {
      return <LottieQuickEditComposer document={document} nodeId={nodeId} box={box} />;
    }
    return <ImageQuickEditComposer document={document} nodeId={nodeId} box={box} />;
  }

  const flipRotateToolbar = (
    <FlipRotateToolbar
      nodeId={nodeId}
      angle={Number(node?.attrs?.angle) || 0}
      flipX={node?.attrs?.flipX === true || node?.attrs?.flipX === 'true'}
      flipY={node?.attrs?.flipY === true || node?.attrs?.flipY === 'true'}
    />
  );

  let imageToolbarChrome: ReactNode = null;
  if (kind === 'image') {
    if (flipRotateOpen) {
      imageToolbarChrome = flipRotateToolbar;
    } else if (isIconImageNode(node)) {
      imageToolbarChrome = (
        <IconAnnotateToolbar
          downloadSlot={
            <ExportSelectionPopover
              nodeIds={[nodeId]}
              triggerClassName={cn(imageToolBtn, 'text-white/85 hover:bg-white/10')}
            />
          }
        />
      );
    } else {
      imageToolbarChrome = (
        <>
          <button
            type="button"
            className={imageToolBtn}
            onClick={() => dispatch(openImageToolPanel({ nodeId, kind: 'quickEdit' }))}
          >
            <HiOutlineSparkles className="h-4 w-4" strokeWidth={2} />
            <span>{t('editor.imageToolbar.chat')}</span>
          </button>
          <ImageToolSep />
          <ImageToolbarEditTools
            onUpscale={() => dispatch(openImageToolPanel({ nodeId, kind: 'upscale' }))}
            onRemoveBg={(mode) =>
              runImageProcess(
                'removeBg',
                t('editor.imageToolbar.processingRemoveBg'),
                undefined,
                { cutoutMode: mode }
              )
            }
            onEraser={() => dispatch(openImageToolPanel({ nodeId, kind: 'eraser' }))}
            onMark={() => dispatch(openImageToolPanel({ nodeId, kind: 'mark' }))}
            onReplaceText={
              String(node?.attrs?.letteringText || '').trim()
                ? () => dispatch(openImageToolPanel({ nodeId, kind: 'replaceText' }))
                : undefined
            }
            onEditElements={() => {
              message.error(unsupportedImageProcessKindMessage('editElements'));
            }}
            onMultiAngle={() =>
              dispatch(openImageToolPanel({ nodeId, kind: 'multiAngle' }))
            }
          />
          {showBlend ? (
            <>
              <Sep />
              <BlendModeControl
                blendMode={node?.attrs?.blendMode}
                opacity={node?.attrs?.opacity}
                onBlendModeChange={(mode) =>
                  dispatch(
                    patchDocumentNode({ nodeId, patch: { attrs: { blendMode: mode } } })
                  )
                }
                onOpacityChange={(opacity) =>
                  dispatch(patchDocumentNode({ nodeId, patch: { attrs: { opacity } } }))
                }
                onOpacityOpen={() =>
                  dispatch(openImageToolPanel({ nodeId, kind: 'opacity' }))
                }
                afterBlendSlot={
                  supportsCornerRadius(node) ? (
                    <Tooltip tip={t('editor.imageToolbar.cornerRadius')} placement="top">
                      <button
                        type="button"
                        aria-label={t('editor.imageToolbar.cornerRadius')}
                        className={SEL_TOOL_BTN}
                        onClick={() =>
                          dispatch(
                            openShapeStylePanel({ kind: 'radius', nodeIds: [nodeId] })
                          )
                        }
                      >
                        <IconCornerRadius className="h-4 w-4" />
                        <span className="tabular-nums">{toolbarCornerRadius}</span>
                      </button>
                    </Tooltip>
                  ) : null
                }
              />
            </>
          ) : null}
          <ImageToolbarMoreDownload
            onAction={(key) => {
              if (key === 'expand') {
                dispatch(openImageToolPanel({ nodeId, kind: 'expand' }));
                return;
              }
              if (key === 'crop') {
                dispatch(openImageToolPanel({ nodeId, kind: 'crop' }));
                return;
              }
              if (key === 'adjust') {
                dispatch(openImageToolPanel({ nodeId, kind: 'adjust' }));
                return;
              }
              if (key === 'flipRotate') {
                dispatch(openImageToolPanel({ nodeId, kind: 'flipRotate' }));
              }
            }}
          />
          <Sep />
          <Tooltip
            tip={
              imageAspectLocked
                ? t('editor.imageToolbar.unlockAspect')
                : t('editor.imageToolbar.lockAspect')
            }
            placement="top"
          >
            <button
              type="button"
              aria-label={
                imageAspectLocked
                  ? t('editor.imageToolbar.unlockAspect')
                  : t('editor.imageToolbar.lockAspect')
              }
              aria-pressed={imageAspectLocked}
              className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
                imageAspectLocked && 'bg-[var(--accent-soft)] text-[var(--ink)]'
              )}
              onClick={() =>
                dispatch(
                  patchDocumentNode({
                    nodeId,
                    patch: {
                      attrs: { lockAspect: imageAspectLocked ? 'false' : 'true' },
                    },
                  })
                )
              }
            >
              {imageAspectLocked ? (
                <HiOutlineLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <HiOutlineLinkSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>
          </Tooltip>
          <ImageFullscreenPreviewButton src={String(node?.attrs?.src || '')} />
          <ExportSelectionPopover nodeIds={[nodeId]} triggerClassName={imageToolBtn} />
        </>
      );
    }
  }

  let videoToolbarChrome: ReactNode = null;
  if (kind === 'video') {
    if (flipRotateOpen) {
      videoToolbarChrome = (
        <FlipRotateToolbar
          nodeId={nodeId}
          angle={Number(node?.attrs?.angle) || 0}
          flipX={node?.attrs?.flipX === true || node?.attrs?.flipX === 'true'}
          flipY={node?.attrs?.flipY === true || node?.attrs?.flipY === 'true'}
          hideRotate
        />
      );
    } else {
      videoToolbarChrome = (
        <VideoToolbarEditTools
          nodeId={nodeId}
          onQuickEdit={() =>
            dispatch(openImageToolPanel({ nodeId, kind: 'quickEdit' }))
          }
          onTrim={() => {
            // Capture playhead before trim UI hides the hover host / remounts preview.
            const host = getVideoHoverHost(nodeId);
            const video = host?.getVideo?.();
            const vals = [host?.getFreezeAt?.(), host?.getMediaTime?.(), video?.currentTime]
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x) && x >= 0);
            const keepTime = vals.length ? Math.max(...vals) : 0;
            dispatch(openVideoToolPanel({ nodeId, kind: 'trim', keepTime }));
          }}
          onCrop={() => dispatch(openImageToolPanel({ nodeId, kind: 'crop' }))}
          onFlipRotate={() =>
            dispatch(openImageToolPanel({ nodeId, kind: 'flipRotate' }))
          }
          downloadSlot={
            <VideoDownloadButton
              src={String(node?.attrs?.src || '')}
              name={String(node?.attrs?.name || 'video')}
              uploadKey={
                String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null
              }
              cropX={Number(node?.attrs?.cropX)}
              cropY={Number(node?.attrs?.cropY)}
              cropW={Number(node?.attrs?.cropW)}
              cropH={Number(node?.attrs?.cropH)}
              trimStart={Number(node?.attrs?.trimStart)}
              trimEnd={Number(node?.attrs?.trimEnd)}
              flipX={node?.attrs?.flipX === true || node?.attrs?.flipX === 'true'}
              flipY={node?.attrs?.flipY === true || node?.attrs?.flipY === 'true'}
            />
          }
          fullscreenSlot={
            <VideoFullscreenPreviewButton
              src={String(node?.attrs?.src || '')}
              poster={String(node?.attrs?.poster || '').trim() || null}
              uploadKey={
                String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null
              }
              aspectWidth={Number(node?.width) || undefined}
              aspectHeight={Number(node?.height) || undefined}
              cropX={Number(node?.attrs?.cropX)}
              cropY={Number(node?.attrs?.cropY)}
              cropW={Number(node?.attrs?.cropW)}
              cropH={Number(node?.attrs?.cropH)}
              trimStart={Number(node?.attrs?.trimStart)}
              trimEnd={Number(node?.attrs?.trimEnd)}
              flipX={node?.attrs?.flipX === true || node?.attrs?.flipX === 'true'}
              flipY={node?.attrs?.flipY === true || node?.attrs?.flipY === 'true'}
              duration={Number(node?.attrs?.duration)}
            />
          }
        />
      );
    }
  }

  return (
    <>
      <SelectionToolbarShell
        box={box}
        edgePadScene={edgePadScene}
        hasTitleLabel={
          kind === 'image' || kind === 'video' || kind === 'lottie' || kind === 'audio'
        }
        bare={kind === 'image' && isIconImageNode(node)}
      >
          {/* Order: Style/Edit → Geometry → Blend/Opacity → Actions */}
          {kind === 'text' && style ? (
            <>
              <ColorPanelPopover
                value={String(style.fill || '#333333')}
                opacity={style.fillOpacity ?? 100}
                showAlpha
                onChange={(hex) => patchTextStyle({ fill: hex })}
                onOpacityChange={(opacity) => patchTextStyle({ fillOpacity: opacity })}
                title={'文字颜色'}
                placement="bottom-start"
                className={btn}
              />
              <FontFamilyPicker
                value={fontFamily}
                onChange={({ fontFamily: nextFamily, fontWeight }) => {
                  patchTextStyle({ fontFamily: nextFamily, fontWeight });
                  setFontCatalogTick((n) => n + 1);
                }}
              />
              {showWeightSelect ? (
                <ToolbarMenuSelect
                  value={weightSelectValue}
                  options={weightSelectOptions}
                  onChange={(v) => {
                    const parsed = parseWeightSelectValue(v);
                    patchTextStyle({ fontFamily: parsed.family, fontWeight: parsed.weight });
                  }}
                  displayLabel={weightDisplayLabel}
                />
              ) : null}
              <ToolbarMenuSelect
                value={String(style.fontSize)}
                options={SIZE_OPTIONS}
                onChange={(v) => patchTextStyle({ fontSize: Number(v) })}
                displayLabel={String(style.fontSize)}
                editable
                inputMin={1}
                inputMax={400}
              />
              {showBoldToggle ? (
                <Tooltip tip={t('editor.imageToolbar.bold')} placement="top">
                  <button
                    type="button"
                    aria-label={t('editor.imageToolbar.bold')}
                    className={cn(SEL_ICON_BTN, isTextBold(style) && SEL_ICON_BTN_ACTIVE)}
                    aria-pressed={isTextBold(style)}
                    onClick={() =>
                      patchTextStyle({
                        fontWeight: isTextBold(style) ? 'normal' : 'bold',
                      })
                    }
                  >
                    <HiOutlineBold className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </Tooltip>
              ) : null}
              <Tooltip tip={t('editor.imageToolbar.italic')} placement="top">
                <button
                  type="button"
                  aria-label={t('editor.imageToolbar.italic')}
                  className={cn(SEL_ICON_BTN, isTextItalic(style) && SEL_ICON_BTN_ACTIVE)}
                  aria-pressed={isTextItalic(style)}
                  onClick={() =>
                    patchTextStyle({ fontStyle: isTextItalic(style) ? 'normal' : 'italic' })
                  }
                >
                  <HiOutlineItalic className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </Tooltip>
              <div className="relative" data-text-toolbar-menu>
                <Tooltip tip={t('editor.imageToolbar.decoration')} placement="top">
                  <button
                    type="button"
                    aria-label={t('editor.imageToolbar.decoration')}
                    aria-expanded={decorationOpen}
                    className={cn(
                      SEL_ICON_BTN,
                      'gap-0.5 px-1',
                      (decorationOpen ||
                        isTextUnderline(style) ||
                        isTextOverline(style) ||
                        isTextStrike(style)) &&
                        SEL_ICON_BTN_ACTIVE
                    )}
                    onClick={() => {
                      setAlignOpen(false);
                      setDecorationOpen((v) => !v);
                    }}
                  >
                    <DecorationsTriggerIcon
                      underline={isTextUnderline(style)}
                      overline={isTextOverline(style)}
                      strike={isTextStrike(style)}
                    />
                    <HiOutlineChevronDown className="h-3 w-3 text-current" />
                  </button>
                </Tooltip>
                {decorationOpen ? (
                  <DropdownPanel className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-max">
                    {(
                      [
                        {
                          token: 'underline' as const,
                          label: t('editor.imageToolbar.underline'),
                          Icon: HiOutlineUnderline,
                          on: isTextUnderline(style),
                        },
                        {
                          token: 'overline' as const,
                          label: t('editor.imageToolbar.overline'),
                          Icon: MdFormatOverline,
                          on: isTextOverline(style),
                        },
                        {
                          token: 'line-through' as const,
                          label: t('editor.imageToolbar.strike'),
                          Icon: HiOutlineStrikethrough,
                          on: isTextStrike(style),
                        },
                      ] as const
                    ).map(({ token, label, Icon, on }) => (
                      <DropdownPanelItem
                        key={token}
                        selected={on}
                        className="gap-2 whitespace-nowrap"
                        onClick={() =>
                          patchTextStyle({
                            textDecoration: toggleTextDecoration(style.textDecoration, token),
                          })
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">{label}</span>
                        {on ? (
                          <span className="ml-auto text-[11px] text-[var(--muted)]">✓</span>
                        ) : null}
                      </DropdownPanelItem>
                    ))}
                  </DropdownPanel>
                ) : null}
              </div>
              <div className="relative" data-text-toolbar-menu>
                <Tooltip tip={t('editor.imageToolbar.align')} placement="top">
                  <button
                    type="button"
                    aria-label={t('editor.imageToolbar.align')}
                    aria-expanded={alignOpen}
                    className={cn(SEL_ICON_BTN, 'gap-0.5 px-1', alignOpen && SEL_ICON_BTN_ACTIVE)}
                    onClick={() => {
                      setDecorationOpen(false);
                      setAlignOpen((v) => !v);
                    }}
                  >
                    <AlignIcon align={textAlign} />
                    <HiOutlineChevronDown className="h-3 w-3 text-current" />
                  </button>
                </Tooltip>
                {alignOpen ? (
                  <DropdownPanel className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-max">
                    {(
                      [
                        {
                          value: 'left',
                          label: t('editor.imageToolbar.alignLeft'),
                          Icon: MdFormatAlignLeft,
                        },
                        {
                          value: 'center',
                          label: t('editor.imageToolbar.alignCenter'),
                          Icon: MdFormatAlignCenter,
                        },
                        {
                          value: 'right',
                          label: t('editor.imageToolbar.alignRight'),
                          Icon: MdFormatAlignRight,
                        },
                      ] as const
                    ).map(({ value, label, Icon }) => (
                      <DropdownPanelItem
                        key={value}
                        selected={textAlign === value}
                        className="gap-2 whitespace-nowrap"
                        onClick={() => {
                          patchTextStyle({ textAlign: value });
                          setAlignOpen(false);
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[var(--ink)]" />
                        <span className="whitespace-nowrap">{label}</span>
                        {textAlign === value ? (
                          <span className="ml-auto text-[11px] text-[var(--muted)]">✓</span>
                        ) : null}
                      </DropdownPanelItem>
                    ))}
                  </DropdownPanel>
                ) : null}
              </div>
              <Tooltip tip={t('editor.openTextEditor')} placement="top">
                <button
                  type="button"
                  aria-label={t('editor.openTextEditor')}
                  className={SEL_ICON_BTN}
                  onClick={() => setMdOpen(true)}
                >
                  <HiOutlineCodeBracket className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              {canOutlineNode(node) ? (
                <Tooltip tip="Outline" placement="top">
                  <button
                    type="button"
                    aria-label="Outline"
                    className={SEL_ICON_BTN}
                    onClick={async () => {
                      const hide = message.loading('Outlining…', 0);
                      try {
                        const outline = await buildOutlinePathAsync(node);
                        if (!outline?.pathD) {
                          message.error('Outline failed');
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
                        message.success('Outlined');
                      } finally {
                        hide();
                      }
                    }}
                  >
                    <TbVectorBezier className="h-4 w-4" />
                  </button>
                </Tooltip>
              ) : null}
              {blendControl ? (
                <>
                  <Sep />
                  {blendControl}
                </>
              ) : null}
              <Sep />
              <ExportSelectionPopover nodeIds={[nodeId]} />
            </>
          ) : null}

          {imageToolbarChrome}

          {videoToolbarChrome}

          {kind === 'lottie' ? (
            <LottieToolbarEditTools
              nodeId={nodeId}
              loop={!(
                node?.attrs?.lottieLoop === false ||
                node?.attrs?.lottieLoop === 'false' ||
                node?.attrs?.lottieLoop === 0 ||
                node?.attrs?.lottieLoop === '0'
              )}
              speed={Math.max(0.25, Number(node?.attrs?.lottieSpeed) || 1)}
            />
          ) : null}

          {kind === 'audio' ? (
            <AudioToolbarEditTools
              onQuickEdit={() =>
                dispatch(openImageToolPanel({ nodeId, kind: 'quickEdit' }))
              }
              onTrim={() => {
                const host = getAudioHost(nodeId);
                const keepTime = Math.max(0, Number(host?.getMediaTime()) || 0);
                dispatch(openAudioToolPanel({ nodeId, kind: 'trim', keepTime }));
              }}
              onSpeed={() => dispatch(openAudioToolPanel({ nodeId, kind: 'speed' }))}
            />
          ) : null}

          {kind === 'shape' || kind === 'rect' || kind === 'ellipse' || kind === 'path' ? (
            <>
              <ShapeSelectionToolbar nodeId={nodeId} node={node} box={box} hideExport />
              {blendControl}
              <Sep />
              <ExportSelectionPopover nodeIds={[nodeId]} />
            </>
          ) : null}
          {kind === 'svg' ? (
            <>
              {blendControl ? (
                <>
                  {blendControl}
                  <Sep />
                </>
              ) : null}
              <ExportSelectionPopover nodeIds={[nodeId]} />
            </>
          ) : null}
          <Sep />
          <SendToChatToolbarAction target={nodeId} />
      </SelectionToolbarShell>

      {kind === 'text' ? (
        <TextEditDialog
          open={mdOpen}
          initialMarkdown={parseNodeMarkdown(node.attrs || {})}
          onClose={() => setMdOpen(false)}
          onSave={(md) => {
            const textStyle = parseNodeTextStyle(node.attrs || {});
            const attrs = buildMarkdownTextAttrs(md, textStyle);
            const plain = markdownToPlain(md);
            const measured = measurePlainTextSize(plain || ' ', textStyle);
            dispatch(
              patchDocumentNode({
                nodeId,
                patch: {
                  attrs,
                  width: Math.max(measured.width, 8),
                  height: Math.max(
                    measured.height,
                    Math.ceil((textStyle.fontSize || 16) * (textStyle.lineHeight || 1.4))
                  ),
                },
              })
            );
          }}
        />
      ) : null}
    </>
  );
}

export default memo(SelectionContextToolbar);
