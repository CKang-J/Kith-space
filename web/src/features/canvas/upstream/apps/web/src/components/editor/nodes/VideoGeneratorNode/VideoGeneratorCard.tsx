/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoGeneratorNode/VideoGeneratorCard.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { HiArrowUp, HiOutlineBolt, HiOutlineChevronDown, HiOutlinePlus, HiOutlineViewfinderCircle } from 'react-icons/hi2';
type LlmModel = { id: string; kind?: string; label?: string; [key: string]: unknown };
import { useBillingEnabled } from '@recombyn-native/service/wallet';
import { Dropdown, DropdownPanel, message, Tooltip } from '@recombyn-native/components/base';
import {
  rcbScreenPxToScene,
  useRcbCamera,
} from '@recombyn-native/components/rcb';
import {
  SELECTION_TOOLBAR_BELOW_BOX_GAP_PX,
  useChromePointerActivate,
  WorldScreenChromeRoot,
} from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  buildAttachRefMentionContext,
  chipBaseKey,
  composerAttachmentMediaKind,
  parseAtMentionQuery,
  stripTrailingAtQuery,
  upsertLibraryAssetAttachment,
  type AgentComposerHandle,
  type ComposerContext,
} from '@recombyn-native/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@recombyn-native/components/editor/panels/agent/AgentComposerShell';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@recombyn-native/components/editor/panels/agent/MentionAttachPanel';
import type { UserAsset } from '@recombyn-native/models/assets';
import { AspectRatioGlyph } from '@recombyn-native/components/editor/panels/agent/ImageAspectRatioPicker';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@recombyn-native/components/editor/panels/agent/ModelPickerPanel';
import { flyPickIntoImageComposer } from '@recombyn-native/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard';
import {
  canAttachNodeToChat,
  canvasAttachPickPayload,
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  captureVideoPosterFrame
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  expandSelectionWithGroups
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  clearCanvasAttachPick,
  consumePendingCanvasAttach,
  patchDocumentNode,
  startCanvasAttachPick,
  EMPTY_ID_LIST,
} from '@recombyn-native/store/modules/editor';
import { noteCanvasFlyLand } from '@recombyn-native/components/editor/panels/agent/flyToChat';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { estimateVideoCredits } from '@recombyn-native/utils/imageCredits';
import { readFileAsDataUrl } from '@/features/canvas/adapters/recombynLocalMedia';
import { buildByokAwareModelList, DEFAULT_CLOUD_VIDEO_MODEL_ID, cloudVideoFallbackId } from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { customProvidersAsModels } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
import store from '@recombyn-native/store';

type Props = {
  nodeId: string;
  /** Scene plate box 鈥?composer anchors under it; promote keeps document geometry. */
  sceneBox: { x: number; y: number; width: number; height: number };
  /** Composer only shows while the generator node is selected. */
  showComposer?: boolean;
  disabled?: boolean;
};

const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const DEFAULT_VIDEO_ASPECT_RATIO: string = '16:9';

const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
const DEFAULT_VIDEO_RESOLUTION: string = '720p';

const VIDEO_DURATIONS = [4, 5, 6, 7, 8, 10, 12, 15] as const;
const DEFAULT_VIDEO_DURATION = 5;

function modelIsVideoGenerator(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model) return false;
  if (model.kind === 'video') return true;
  return /seedance/i.test(model.id || '');
}

/** Local desktop: BYOK only. Cloud/web: platform video catalog + BYOK. */
function buildVideoGeneratorModelList(res?: {
  models?: LlmModel[] | null;
  videoModels?: LlmModel[] | null;
} | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models, res?.videoModels],
    filter: (m) => modelIsVideoGenerator(m),
  });
}

function nextVideoModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred = models.find((m) => m.id === DEFAULT_CLOUD_VIDEO_MODEL_ID);
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
}

function readGenAttrString(attrs: Record<string, unknown> | null | undefined, key: string) {
  const raw = attrs?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function readGenAttrDuration(attrs: Record<string, unknown> | null | undefined) {
  const raw = attrs?.videoGenDuration;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(4, Math.min(15, Math.round(n)));
}

/** Keep plate area; apply new aspect ratio; return size centered on current box. */
function plateSizeForVideoAspect(
  box: { x: number; y: number; width: number; height: number },
  aspectRatio: string
) {
  const [rw, rh] = String(aspectRatio || DEFAULT_VIDEO_ASPECT_RATIO)
    .split(':')
    .map(Number);
  const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
  const area = Math.max(1, box.width * box.height);
  let height = Math.sqrt(area / ratio);
  let width = height * ratio;
  // Soft clamp so extreme ratios stay editable on canvas.
  const maxSide = Math.max(box.width, box.height) * 1.6;
  const minSide = 120;
  if (Math.max(width, height) > maxSide) {
    const s = maxSide / Math.max(width, height);
    width *= s;
    height *= s;
  }
  if (Math.min(width, height) < minSide) {
    const s = minSide / Math.min(width, height);
    width *= s;
    height *= s;
  }
  width = Math.max(minSide, Math.round(width));
  height = Math.max(minSide, Math.round(height));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    width,
    height,
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
  };
}

/** Attach currently selected canvas nodes/frames into the video composer (excl. host). */
async function attachSelectionToVideoComposer(opts: {
  hostNodeId: string;
  landId: string;
  document: SceneDocument;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  existing: ComposerContext[];
  setContexts: (
    next: ComposerContext[] | ((prev: ComposerContext[]) => ComposerContext[])
  ) => void;
  insertChip: (ctx: ComposerContext) => void;
}): Promise<boolean> {
  const {
    hostNodeId,
    landId,
    document: doc,
    selectedNodeIds,
    selectedFrameIds,
    existing,
    setContexts,
    insertChip,
  } = opts;
  const seed = expandSelectionWithGroups(
    doc,
    (selectedNodeIds || []).filter((id) => id && id !== hostNodeId)
  );
  const attachable = seed.filter((id) => canAttachNodeToChat(doc?.deltaSetLike?.[id]));
  const frameId = (selectedFrameIds || []).find(Boolean) || null;
  if (!attachable.length && !frameId) return false;
  const payload = canvasAttachPickPayload(attachable, frameId);
  await flyPickIntoImageComposer({
    landId,
    document: doc,
    payload,
    existing,
    setContexts,
    insertChip,
    imagesOnly: false,
  });
  return true;
}

/** Pill track shared by the resolution / duration rows. */
function VideoSegmentedTrack({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">{children}</div>;
}

function VideoSegmentPill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium tabular-nums transition disabled:opacity-40',
        active
          ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
          : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]'
      )}
    >
      {children}
    </button>
  );
}

/** Aspect chips + resolution + duration 鈥?video's answer to ImageAspectRatioPicker. */
function VideoSettingsPanel({
  aspectRatio,
  resolution,
  duration,
  onAspectRatioChange,
  onResolutionChange,
  onDurationChange,
  disabled,
}: {
  aspectRatio: string;
  resolution: string;
  duration: number;
  onAspectRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: string) => void;
  onDurationChange: (duration: number) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">{t('agent.chooseRatio')}</p>
        <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
          {VIDEO_ASPECT_RATIOS.map((ratio) => {
            const active = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                disabled={disabled}
                title={ratio}
                onClick={(e) => {
                  e.stopPropagation();
                  onAspectRatioChange(ratio);
                }}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                <AspectRatioGlyph ratio={ratio} size={20} />
                <span className="max-w-full truncate text-[10px] font-medium tabular-nums">
                  {ratio}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('agent.chooseResolution')}
        </p>
        <VideoSegmentedTrack>
          {VIDEO_RESOLUTIONS.map((r) => (
            <VideoSegmentPill
              key={r}
              active={resolution === r}
              disabled={disabled}
              onClick={() => onResolutionChange(r)}
            >
              {r}
            </VideoSegmentPill>
          ))}
        </VideoSegmentedTrack>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('editor.tools.videoDuration', { defaultValue: '鏃堕暱' })}
        </p>
        <VideoSegmentedTrack>
          {VIDEO_DURATIONS.map((n) => (
            <VideoSegmentPill
              key={n}
              active={duration === n}
              disabled={disabled}
              onClick={() => onDurationChange(n)}
            >
              {t('editor.tools.videoDurationNs', { n })}
            </VideoSegmentPill>
          ))}
        </VideoSegmentedTrack>
      </div>
    </div>
  );
}

function VideoGeneratorCard({
  nodeId,
  sceneBox,
  showComposer = true,
  disabled,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { zoom } = useRcbCamera();
  const chromePointer = useChromePointerActivate();
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const genAttrs = useSelector(
    (state: any) => state.editor?.document?.deltaSetLike?.[nodeId]?.attrs as
      | Record<string, unknown>
      | undefined
  );
  const editorDocument = useSelector((state: any) => state.editor?.document);
  const canvasAttachPick = useSelector(
    (state: any) => state.editor?.canvasAttachPick as null | { target: string }
  );
  const pendingCanvasAttach = useSelector(
    (state: any) =>
      state.editor?.pendingCanvasAttach as null | {
        target: string;
        payload: string | string[];
      }
  );
  const pickTarget = `node:${nodeId}`;
  const pickingFromCanvas = canvasAttachPick?.target === pickTarget;
  const selectedNodeIds = useSelector(
    (state: any) => (state.editor?.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const selectedFrameIds = useSelector(
    (state: any) => (state.editor?.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );

  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [resolution, setResolution] = useState<string>(() => {
    return readGenAttrString(genAttrs, 'videoGenResolution') || DEFAULT_VIDEO_RESOLUTION;
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    return readGenAttrString(genAttrs, 'videoGenAspect') || DEFAULT_VIDEO_ASPECT_RATIO;
  });
  const [duration, setDuration] = useState<number>(() => {
    return readGenAttrDuration(genAttrs) ?? DEFAULT_VIDEO_DURATION;
  });
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [modelId, setModelId] = useState(() => {
    return readGenAttrString(genAttrs, 'videoGenModel') || cloudVideoFallbackId();
  });
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const contextsRef = useRef<ComposerContext[]>([]);
  contextsRef.current = contexts;

  useEffect(() => {
    if (!pendingCanvasAttach || pendingCanvasAttach.target !== pickTarget) return;
    const payload = pendingCanvasAttach.payload;
    dispatch(consumePendingCanvasAttach());
    const doc = editorDocument || (store.getState() as any).editor?.document;
    async function flyPendingAttach() {
      await flyPickIntoImageComposer({
        landId: pickTarget,
        document: doc,
        payload,
        existing: contextsRef.current,
        setContexts,
        imagesOnly: false,
        insertChip: (ctx) => {
          inputRef.current?.insertContextAtCaret(ctx);
          inputRef.current?.focus();
        },
      });
    }
    flyPendingAttach();
  }, [pendingCanvasAttach, pickTarget, editorDocument, dispatch]);

  // Re-hydrate after overlay remount (e.g. geometry transform hides the portal).
  useEffect(() => {
    const nextAspect = readGenAttrString(genAttrs, 'videoGenAspect');
    if (nextAspect) setAspectRatio(nextAspect);
    const nextRes = readGenAttrString(genAttrs, 'videoGenResolution');
    if (nextRes) setResolution(nextRes);
    const nextDuration = readGenAttrDuration(genAttrs);
    if (nextDuration != null) setDuration(nextDuration);
    const nextModel = readGenAttrString(genAttrs, 'videoGenModel');
    if (nextModel) setModelId(nextModel);
  }, [
    nodeId,
    genAttrs?.videoGenAspect,
    genAttrs?.videoGenResolution,
    genAttrs?.videoGenDuration,
    genAttrs?.videoGenModel,
  ]);

  // Auto-focus when the generator composer appears (select plate / show again).
  useEffect(() => {
    if (!showComposer || disabled) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [showComposer, nodeId, disabled]);

  useEffect(() => {
    const unique = buildVideoGeneratorModelList(null);
    setModels(unique);
    setModelsStatus('ready');
    const nextId = nextVideoModelId(unique, modelId);
    if (nextId) setModelId(nextId);
    // Stage 1 model choices are local-only; no Recombyn catalog request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachments = useMemo(
    () => contexts.filter((c) => c.kind === 'attachment'),
    [contexts]
  );
  const attachmentsUploading = attachments.some((c) => c.uploadStatus === 'uploading');
  /** Attachments render as thumbs above; keep long filenames out of the inline composer chips. */
  const inlineContexts = useMemo(
    () => contexts.filter((c) => c.kind !== 'attachment'),
    [contexts]
  );
  const selectedModel = models.find((m) => m.id === modelId);
  const billingEnabled = useBillingEnabled();
  const creditCost = estimateVideoCredits(selectedModel);
  const settingsSummary = `${resolution} · ${aspectRatio} · ${duration}s`;

  const removeContext = (key: string) =>
    setContexts((prev) =>
      prev.filter((c) => c.key !== key && chipBaseKey(c.key) !== chipBaseKey(key))
    );

  const onPickRef = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    e.target.value = '';
    if (!files.length) return;
    await attachRefFiles(files);
  };

  const attachRefFiles = async (files: File[]) => {
    const media = files.filter(
      (file) => file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    if (!media.length) return;
    const results = await Promise.all(
      media.map(async (file, index) => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          let thumbUrl = dataUrl;
          if (file.type.startsWith('video/')) {
            try {
              thumbUrl = await captureVideoPosterFrame(dataUrl);
            } catch {
              thumbUrl = dataUrl;
            }
          }
          return {
            key: `attach:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`,
            label: file.name || t('editor.tools.videoGenRef'),
            kind: 'attachment' as const,
            payload: file.type.startsWith('video/')
              ? `[Attached video]\nname: ${file.name}\nmime: ${file.type}`
              : `[Attached image]\nname: ${file.name}\nmime: ${file.type}`,
            dataUrl,
            thumbUrl,
            uploadStatus: 'ready' as const,
          } satisfies ComposerContext;
        } catch {
          message.error(t('agent.attachReadFailed', { name: file.name }));
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (next.length) setContexts((previous) => [...previous, ...next]);
  };

  // `@` opens the attachment mention panel, mirroring the chat composer.
  const maybeOpenMentionFromAt = (next: string) => {
    const parsed = parseAtMentionQuery(next);
    setMentionQuery(parsed.query);
    setMentionOpen(parsed.open);
  };

  const mentionItems = useMemo((): MentionAttachItem[] => {
    return attachments.map((c, i) => {
      const kind = composerAttachmentMediaKind(c);
      const thumb = String(c.thumbUrl || c.dataUrl || '').trim();
      return {
        id: c.key,
        label:
          kind === 'video'
            ? t('agent.mentionAttachVideoN', { n: i + 1 })
            : t('agent.mentionAttachImageN', { n: i + 1 }),
        mediaKind: kind === 'video' ? 'video' : 'image',
        ...((kind === 'image' || kind === 'video') && thumb ? { thumbUrl: thumb } : {}),
      };
    });
  }, [attachments, t]);

  const insertMentionFromAttachment = (att: ComposerContext, n: number) => {
    const kind = composerAttachmentMediaKind(att);
    const ctx = buildAttachRefMentionContext(
      att,
      kind === 'video'
        ? t('agent.mentionAttachVideoN', { n })
        : t('agent.mentionAttachImageN', { n }),
      att.payload || `[User attachment ${n}]`
    );
    setPrompt(stripTrailingAtQuery(prompt));
    setMentionOpen(false);
    setMentionQuery('');
    queueMicrotask(() => {
      inputRef.current?.insertContextAtCaret(ctx);
      inputRef.current?.focus();
    });
  };

  const pickMentionAttach = (pickId: string) => {
    const list = contextsRef.current.filter((c) => c.kind === 'attachment');
    const idx = list.findIndex((c) => c.key === pickId);
    if (idx < 0) return;
    insertMentionFromAttachment(list[idx]!, idx + 1);
  };

  const pickMentionLibraryAsset = (asset: UserAsset) => {
    if (asset.kind !== 'image' && asset.kind !== 'video') return;
    const upserted = upsertLibraryAssetAttachment(
      contextsRef.current,
      asset,
      asset.kind === 'video' ? t('me.assetKindVideo') : t('me.assetKindImage')
    );
    if (!upserted) return;
    setContexts(upserted.contexts);
    contextsRef.current = upserted.contexts;
    insertMentionFromAttachment(upserted.attachment, upserted.ordinal);
  };

  const mentionFloating = useFloating({
    open: mentionOpen,
    onOpenChange: (open) => {
      setMentionOpen(open);
      if (!open) setMentionQuery('');
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 12 }),
    ],
  });
  const mentionDismiss = useDismiss(mentionFloating.context);
  const mentionIx = useInteractions([mentionDismiss]);

  useLayoutEffect(() => {
    if (!mentionOpen) return;
    mentionFloating.refs.setPositionReference({
      getBoundingClientRect: () =>
        inputRef.current?.getAtMentionAnchorRect?.() ?? new DOMRect(),
    });
    mentionFloating.update();
  }, [mentionOpen, mentionQuery, prompt, mentionFloating.refs, mentionFloating.update]);

  const onGenerate = () => {
    message.warning(
      t('editor.tools.stageOneGenerationUnavailable', {
        defaultValue: 'Kith Media Job 尚未实现，Stage 1 暂不支持生成',
      })
    );
  };

  const persistGenSettings = (
    patch: {
      aspect?: string;
      resolution?: string;
      duration?: number;
      model?: string;
    },
    opts?: { skipHistory?: boolean }
  ) => {
    const attrs: Record<string, unknown> = {};
    if (patch.aspect != null) attrs.videoGenAspect = patch.aspect;
    if (patch.resolution != null) attrs.videoGenResolution = patch.resolution;
    if (patch.duration != null) attrs.videoGenDuration = patch.duration;
    if (patch.model != null) attrs.videoGenModel = patch.model;
    if (!Object.keys(attrs).length) return;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: { attrs },
        skipHistory: opts?.skipHistory !== false,
      })
    );
  };

  const applyAspectToNode = (nextAspect: string) => {
    setAspectRatio(nextAspect);
    if (disabled || sending) {
      persistGenSettings({ aspect: nextAspect });
      return;
    }
    const next = plateSizeForVideoAspect(sceneBox, nextAspect);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
          attrs: {
            videoGenAspect: nextAspect,
          },
        },
      })
    );
  };

  // Same placement contract as selection toolbars: world-layer under the box.
  const composerLeft = sceneBox.x + sceneBox.width / 2;
  const composerTop =
    sceneBox.y +
    sceneBox.height +
    rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom);

  return (
    <>
      {showComposer ? (
        <WorldScreenChromeRoot
          left={composerLeft}
          top={composerTop}
          anchor="top"
          data-video-generator
          data-sel-toolbar
          data-scene-node-id={nodeId}
          className="pointer-events-auto z-[32] overflow-visible"
          {...chromePointer}
        >
          <div
            className={cn(
              'flex h-[200px] w-[500px] flex-col overflow-visible',
              'rounded-2xl border border-[var(--line)] bg-[var(--surface)]',
              'shadow-[0_8px_28px_rgba(15,23,42,0.12)]'
            )}
          >
          {/* Reference images occupy their own row, using the chat attachment chip. */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {attachments.map((att) => (
              <ComposerAttachmentChip
                key={att.key}
                attachment={att}
                disabled={disabled || sending}
                onRemove={removeContext}
              />
            ))}
            <Tooltip tip={t('editor.tools.videoGenRef')} placement="top">
              <button
                type="button"
                disabled={disabled || sending}
                aria-label={t('editor.tools.videoGenRef')}
                onClick={() => fileRef.current?.click()}
                className={composerAttachActionClass()}
              >
                <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip
              tip={
                pickingFromCanvas
                  ? t('agent.pickFromCanvasCancel')
                  : t('agent.pickFromCanvas')
              }
              placement="top"
            >
              <button
                type="button"
                disabled={disabled || sending}
                aria-label={t('agent.pickFromCanvas')}
                aria-pressed={pickingFromCanvas}
                onClick={() => {
                  if (pickingFromCanvas) {
                    dispatch(clearCanvasAttachPick());
                    return;
                  }
                  const doc =
                    editorDocument || (store.getState() as any).editor?.document;
                  const insertChip = (ctx: ComposerContext) => {
                    inputRef.current?.insertContextAtCaret(ctx);
                    inputRef.current?.focus();
                  };
                  async function pickOrAttach() {
                    const attached = await attachSelectionToVideoComposer({
                      hostNodeId: nodeId,
                      landId: pickTarget,
                      document: doc,
                      selectedNodeIds,
                      selectedFrameIds,
                      existing: contextsRef.current,
                      setContexts,
                      insertChip,
                    });
                    if (!attached) {
                      noteCanvasFlyLand(pickTarget);
                      dispatch(startCanvasAttachPick({ target: pickTarget }));
                    }
                  }
                  pickOrAttach();
                }}
                className={composerAttachActionClass(pickingFromCanvas)}
              >
                <HiOutlineViewfinderCircle className="h-4 w-4" strokeWidth={2} />
              </button>
            </Tooltip>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={onPickRef}
            />
          </div>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
          <div
            className="min-h-0 min-w-0 flex-1 cursor-text overflow-y-auto px-3 pt-2"
            onClick={(e) => {
              if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
              inputRef.current?.focus();
            }}
          >
            <AgentComposerInput
              ref={inputRef}
              contexts={inlineContexts}
              onContextsChange={(next) => {
                setContexts([...attachments, ...next]);
              }}
              value={prompt}
              onChange={(next) => {
                setPrompt(next);
                maybeOpenMentionFromAt(next);
              }}
              onSubmit={() => onGenerate()}
              disabled={disabled || sending}
              placeholder={t('editor.tools.videoGenPlaceholder')}
              flyLandId={pickTarget}
              className="min-h-full w-full text-[13px]"
              onPasteImages={(files) => {
                attachRefFiles(files);
              }}
            />
          </div>

          <div className="mt-1 flex items-center gap-1.5 px-2.5 pb-2">
            <Dropdown
              trigger="click"
              placement="top-start"
              strategy="fixed"
              offset={8}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              items={[]}
              floatingClassName="z-[90]"
              referenceClassName="inline-flex min-w-0"
              popupRender={() => (
                <DropdownPanel className="w-[min(26rem,calc(100vw-2rem))] p-3">
                  <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                    {t('editor.tools.videoSettings')}
                  </p>
                  <div onPointerDown={(e) => e.stopPropagation()}>
                    <VideoSettingsPanel
                      aspectRatio={aspectRatio}
                      resolution={resolution}
                      duration={duration}
                      onAspectRatioChange={applyAspectToNode}
                      onResolutionChange={(r) => {
                        setResolution(r);
                        persistGenSettings({ resolution: r });
                      }}
                      onDurationChange={(n) => {
                        setDuration(n);
                        persistGenSettings({ duration: n });
                      }}
                      disabled={disabled || sending}
                    />
                  </div>
                </DropdownPanel>
              )}
            >
              <button
                type="button"
                disabled={disabled || sending}
                className={cn(
                  'inline-flex h-7 max-w-[min(100%,11rem)] items-center gap-1 truncate rounded-full px-2 text-[12px] font-medium transition-colors disabled:opacity-40',
                  settingsOpen
                    ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                    : 'bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--accent-soft)]'
                )}
              >
                <span className="truncate">{settingsSummary}</span>
                <HiOutlineChevronDown
                  className={cn(
                    'h-3 w-3 shrink-0 opacity-70 transition-transform duration-150',
                    settingsOpen && 'rotate-180'
                  )}
                  strokeWidth={2}
                />
              </button>
            </Dropdown>

            <div className="ml-auto flex items-center gap-1">
              <Dropdown
                trigger="click"
                placement="top-end"
                strategy="fixed"
                offset={8}
                open={modelOpen}
                onOpenChange={setModelOpen}
                items={[]}
                floatingClassName="z-[90]"
                referenceClassName="inline-flex"
                popupRender={() => (
                  <div onPointerDown={(e) => e.stopPropagation()}>
                    <ModelPickerPanel
                      tab="video"
                      models={models}
                      selectedId={modelId}
                      status={modelsStatus}
                      hideAuto
                      useModelsAsIs
                      onPick={(id) => {
                        setModelId(id);
                        persistGenSettings({ model: id });
                        setModelOpen(false);
                      }}
                    />
                  </div>
                )}
              >
                <Tooltip
                  tip={selectedModel?.label || modelId}
                  placement="top"
                  disabled={modelOpen}
                >
                  <button
                    type="button"
                    disabled={disabled || sending}
                    aria-label={selectedModel?.label || modelId}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    <ModelBrandIcon
                      model={selectedModel || { id: modelId }}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  </button>
                </Tooltip>
              </Dropdown>

              <Tooltip
                tip={
                  billingEnabled
                    ? t('wallet.creditCostTip', { count: creditCost })
                    : t('agent.send')
                }
                placement="top"
              >
                <button
                  type="button"
                  disabled={disabled || sending || attachmentsUploading || !prompt.trim()}
                  aria-label={t('editor.tools.videoGenSubmit')}
                  onClick={() => onGenerate()}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition',
                    'bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40',
                    !billingEnabled && 'h-7 w-7 justify-center px-0'
                  )}
                >
                  {billingEnabled ? (
                    <>
                      <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={2} />
                      <span className="tabular-nums">{creditCost}</span>
                    </>
                  ) : (
                    <HiArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
          </div>
        </WorldScreenChromeRoot>
      ) : null}

      {showComposer && mentionOpen ? (
        <FloatingPortal>
          <div
            ref={mentionFloating.refs.setFloating}
            style={mentionFloating.floatingStyles as CSSProperties}
            className="z-[95]"
            {...mentionIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              items={mentionItems}
              query={mentionQuery}
              onPick={pickMentionAttach}
              onPickLibraryAsset={pickMentionLibraryAsset}
              assetKinds={['image', 'video']}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(VideoGeneratorCard);
