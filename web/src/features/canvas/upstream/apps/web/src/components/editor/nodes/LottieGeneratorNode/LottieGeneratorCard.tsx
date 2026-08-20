/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/LottieGeneratorNode/LottieGeneratorCard.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Lottie generator composer under the empty plate.
 * On-plate generate 鈫?POST /design/lottie/generate 鈫?promote to Lottie node.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
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
import {
  HiArrowUp,
  HiOutlineBolt,
  HiOutlineChevronDown,
  HiOutlinePlus,
  HiOutlineViewfinderCircle,
} from 'react-icons/hi2';
import { type ChatModelsResponse, type LlmModel } from '@recombyn-native/service/chat';
import { apiQuery, getHttpErrorMessage } from '@recombyn-native/service/client';
import { generateLottie } from '@/features/canvas/adapters/recombynStageOneDesign';
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
import { buildByokAwareModelList, modelSupportsVisionInput } from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { flyPickIntoImageComposer } from '@recombyn-native/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard';
import {
  canAttachNodeToChat,
  canvasAttachPickPayload,
  clearImageProcessAttrs
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  expandSelectionWithGroups
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  parseLottieAnimationData
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  clearCanvasAttachPick,
  consumePendingCanvasAttach,
  EMPTY_ID_LIST,
  finishLottieGenerator,
  patchDocumentNode,
  setDocumentFromCanvas,
  startCanvasAttachPick,
} from '@recombyn-native/store/modules/editor';
import { noteCanvasFlyLand } from '@recombyn-native/components/editor/panels/agent/flyToChat';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { estimateLottieCredits } from '@recombyn-native/utils/imageCredits';
import { readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';
import { customProvidersAsModels } from '@recombyn-native/components/editor/panels/agent/customLlmProviders';
import store from '@recombyn-native/store';

type Props = {
  nodeId: string;
  sceneBox: { x: number; y: number; width: number; height: number };
  showComposer?: boolean;
  disabled?: boolean;
};

const LOTTIE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
const DEFAULT_LOTTIE_ASPECT = '1:1';
/** Seconds 鈥?shorter than video; typical UI / logo loops. */
const LOTTIE_DURATIONS = [1, 2, 3, 5, 8, 10] as const;
const DEFAULT_LOTTIE_DURATION = 3;
const DEFAULT_AGENT_MODEL_ID = '';

function readGenAttrString(attrs: Record<string, unknown> | null | undefined, key: string) {
  const raw = attrs?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function modelIsAgentChat(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model?.id) return false;
  if (model.id === 'auto') return false;
  if (model.kind === 'image' || model.kind === 'video') return false;
  return !/seedance|seedream|t2i|i2i/i.test(model.id);
}

/** Local desktop: BYOK only. Cloud/web: platform chat catalog + BYOK. */
function buildLottieChatModelList(res?: { models?: LlmModel[] | null } | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models],
    filter: (m) => modelIsAgentChat(m),
  });
}

function nextLottieChatModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length) return null;
  if (currentId && models.some((m) => m.id === currentId)) return null;
  return models[0]?.id ?? null;
}

/** First vision-capable chat model; keep preferred if it already supports vision. */
function pickVisionChatModel(
  models: LlmModel[],
  preferredId?: string
): LlmModel | undefined {
  const vision = models.filter((m) => modelSupportsVisionInput(m));
  if (!vision.length) return undefined;
  if (preferredId) {
    const hit = vision.find((m) => m.id === preferredId);
    if (hit) return hit;
  }
  return vision[0];
}

function readGenAttrDuration(attrs: Record<string, unknown> | null | undefined): number | null {
  const raw = attrs?.lottieGenDuration;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function plateSizeForAspect(
  box: { x: number; y: number; width: number; height: number },
  aspectRatio: string
) {
  const [rw, rh] = String(aspectRatio || DEFAULT_LOTTIE_ASPECT)
    .split(':')
    .map(Number);
  const ratio = rw > 0 && rh > 0 ? rw / rh : 1;
  const area = Math.max(1, box.width * box.height);
  let height = Math.sqrt(area / ratio);
  let width = height * ratio;
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

function isImageFile(file: File) {
  return file.type.startsWith('image/');
}

async function attachSelectionToLottieComposer(opts: {
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
    imagesOnly: true,
  });
  return true;
}

function LottieSettingsPanel({
  aspectRatio,
  duration,
  onAspectRatioChange,
  onDurationChange,
  disabled,
}: {
  aspectRatio: string;
  duration: number;
  onAspectRatioChange: (ratio: string) => void;
  onDurationChange: (duration: number) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">{t('agent.chooseRatio')}</p>
        <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
          {LOTTIE_ASPECT_RATIOS.map((ratio) => {
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
          {t('editor.tools.lottieDuration')}
        </p>
        <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">
          {LOTTIE_DURATIONS.map((n) => {
            const active = duration === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onDurationChange(n);
                }}
                className={cn(
                  'flex min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium tabular-nums transition disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                {t('editor.tools.lottieDurationNs', { n })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LottieGeneratorCard({
  nodeId,
  sceneBox,
  showComposer = true,
  disabled = false,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { zoom } = useRcbCamera();
  const chromePointer = useChromePointerActivate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const contextsRef = useRef<ComposerContext[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const genAttrs = useSelector(
    (state: any) =>
      (state.editor?.document?.deltaSetLike?.[nodeId]?.attrs || null) as Record<
        string,
        unknown
      > | null
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
  const selectedNodeIds = useSelector(
    (state: any) => (state.editor?.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const selectedFrameIds = useSelector(
    (state: any) => (state.editor?.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );

  const pickTarget = `node:${nodeId}`;
  const pickingFromCanvas = canvasAttachPick?.target === pickTarget;

  const [prompt, setPrompt] = useState('');
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(
    () => readGenAttrString(genAttrs, 'lottieGenAspect') || DEFAULT_LOTTIE_ASPECT
  );
  const [duration, setDuration] = useState(
    () => readGenAttrDuration(genAttrs) ?? DEFAULT_LOTTIE_DURATION
  );
  const [modelId, setModelId] = useState(() => {
    const saved = readGenAttrString(genAttrs, 'lottieGenModel');
    return saved && saved !== 'auto' ? saved : DEFAULT_AGENT_MODEL_ID;
  });
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );

  contextsRef.current = contexts;

  useEffect(() => {
    if (!showComposer || disabled) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [showComposer, nodeId, disabled]);

  useEffect(() => {
    const nextAspect = readGenAttrString(genAttrs, 'lottieGenAspect');
    if (nextAspect) setAspectRatio(nextAspect);
    const nextDuration = readGenAttrDuration(genAttrs);
    if (nextDuration != null) setDuration(nextDuration);
    const nextModel = readGenAttrString(genAttrs, 'lottieGenModel');
    if (nextModel && nextModel !== 'auto') setModelId(nextModel);
  }, [nodeId, genAttrs?.lottieGenAspect, genAttrs?.lottieGenDuration, genAttrs?.lottieGenModel]);

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
        imagesOnly: true,
        insertChip: (ctx) => {
          inputRef.current?.insertContextAtCaret(ctx);
          inputRef.current?.focus();
        },
      });
    }
    flyPendingAttach();
  }, [pendingCanvasAttach, pickTarget, editorDocument, dispatch]);

  const modelsCatalogQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (modelsCatalogQuery.isPending) {
      setModelsStatus('loading');
      return;
    }
    if (modelsCatalogQuery.isError) {
      setModelsStatus('error');
      return;
    }
    if (!modelsCatalogQuery.isFetched) return;
    const res = modelsCatalogQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModelsStatus('error');
      return;
    }
    const unique = buildLottieChatModelList(res);
    setModels(unique);
    setModelsStatus('ready');
    const nextId = nextLottieChatModelId(unique, modelId);
    if (nextId) setModelId(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelsCatalogQuery.data,
    modelsCatalogQuery.isPending,
    modelsCatalogQuery.isError,
    modelsCatalogQuery.isFetched,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const attachments = useMemo(
    () => contexts.filter((c) => c.kind === 'attachment'),
    [contexts]
  );
  const inlineContexts = useMemo(
    () => contexts.filter((c) => c.kind !== 'attachment'),
    [contexts]
  );
  const imageRefUrls = useMemo(
    () =>
      attachments
        .map((c) => String(c.dataUrl || c.thumbUrl || '').trim())
        .filter((u) => u.startsWith('data:image/') || /^https?:\/\//i.test(u))
        .slice(0, 4),
    [attachments]
  );
  const needsVisionModel = imageRefUrls.length > 0;
  const selectedModel = models.find((m) => m.id === modelId);
  const pickerModels = useMemo(
    () => (needsVisionModel ? models.filter((m) => modelSupportsVisionInput(m)) : models),
    [models, needsVisionModel]
  );
  const billingEnabled = useBillingEnabled();
  const creditCost = estimateLottieCredits(selectedModel, duration);
  const settingsSummary = `${aspectRatio} · ${duration}s`;

  const removeContext = (key: string) =>
    setContexts((prev) =>
      prev.filter((c) => c.key !== key && chipBaseKey(c.key) !== chipBaseKey(key))
    );

  const attachRefFiles = async (files: File[]) => {
    const accepted = files.filter((f) => isImageFile(f));
    if (!accepted.length) {
      message.error(t('editor.tools.lottieGenUploadHint'));
      return;
    }
    const results = await Promise.all(
      accepted.map(async (file, i) => {
        const key = `attach:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            key,
            label: file.name || t('editor.tools.lottieGenRefImage'),
            kind: 'attachment' as const,
            payload: '',
            dataUrl,
            thumbUrl: dataUrl,
          } satisfies ComposerContext;
        } catch {
          message.error(t('agent.attachReadFailed', { name: file.name }));
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (!next.length) return;
    setContexts((prev) => [...prev, ...next]);
  };

  const onPickRef = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    await attachRefFiles(files);
  };

  // `@` opens the attachment mention panel (same as image / video generators).
  const maybeOpenMentionFromAt = (next: string) => {
    const parsed = parseAtMentionQuery(next);
    setMentionQuery(parsed.query);
    setMentionOpen(parsed.open);
  };

  const mentionItems = useMemo(
    (): MentionAttachItem[] =>
      attachments.map((c, i) => ({
        id: c.key,
        label: t('agent.mentionAttachImageN', { n: i + 1 }),
        ...(c.thumbUrl || c.dataUrl ? { thumbUrl: String(c.thumbUrl || c.dataUrl) } : {}),
      })),
    [attachments, t]
  );

  const insertMentionFromAttachment = (att: ComposerContext, n: number) => {
    const ctx = buildAttachRefMentionContext(
      att,
      t('agent.mentionAttachImageN', { n }),
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
    if (asset.kind !== 'image') return;
    const upserted = upsertLibraryAssetAttachment(
      contextsRef.current,
      asset,
      t('me.assetKindImage')
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

  const persistGenSettings = (patch: {
    aspect?: string;
    duration?: number;
    model?: string;
  }) => {
    const attrs: Record<string, unknown> = {};
    if (patch.aspect != null) attrs.lottieGenAspect = patch.aspect;
    if (patch.duration != null) attrs.lottieGenDuration = patch.duration;
    if (patch.model != null) attrs.lottieGenModel = patch.model;
    if (!Object.keys(attrs).length) return;
    dispatch(patchDocumentNode({ nodeId, patch: { attrs } }));
  };

  // Image refs require a vision-capable model 鈥?auto-switch when current can't see images.
  useEffect(() => {
    if (!needsVisionModel || !models.length) return;
    if (modelSupportsVisionInput(selectedModel)) return;
    const next = pickVisionChatModel(models, modelId);
    if (!next || next.id === modelId) return;
    setModelId(next.id);
    persistGenSettings({ model: next.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsVisionModel, models, modelId, selectedModel]);

  const applyAspectToNode = (nextAspect: string) => {
    setAspectRatio(nextAspect);
    persistGenSettings({ aspect: nextAspect });
    const next = plateSizeForAspect(sceneBox, nextAspect);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
          attrs: { lottieGenAspect: nextAspect },
        },
      })
    );
  };

  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || disabled) return;

    let useModelId = modelId;
    if (needsVisionModel && !modelSupportsVisionInput(selectedModel)) {
      const next = pickVisionChatModel(models, modelId);
      if (!next) {
        message.error(t('editor.tools.lottieGenNeedVisionModel'));
        return;
      }
      useModelId = next.id;
      setModelId(next.id);
      persistGenSettings({ model: next.id });
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.lottieGenerating'),
            lottieGenAspect: aspectRatio,
            lottieGenDuration: duration,
            lottieGenModel: useModelId,
            genPrompt: text,
          },
        },
      })
    );
    try {
      if (ac.signal.aborted) return;

      const genW = Math.min(512, Math.max(32, Math.round(sceneBox.width)));
      const genH = Math.min(512, Math.max(32, Math.round(sceneBox.height)));
      const res = await generateLottie(
        {
          prompt: text,
          width: genW,
          height: genH,
          duration_sec: duration,
          model: useModelId || undefined,
          ...(imageRefUrls.length ? { images: imageRefUrls } : {}),
        },
        { signal: ac.signal }
      );
      const animationData = parseLottieAnimationData(res?.animationData) || null;
      if (!animationData) throw new Error(t('editor.tools.lottieGenEmpty'));
      if (ac.signal.aborted) return;

      const aw = Math.max(1, Number(animationData.w) || genW);
      const ah = Math.max(1, Number(animationData.h) || genH);
      // Fit natural animation into current plate (keep center).
      const fit = Math.min(sceneBox.width / aw, sceneBox.height / ah);
      const outW = Math.max(32, Math.round(aw * fit));
      const outH = Math.max(32, Math.round(ah * fit));
      const outX = Math.round(sceneBox.x + (sceneBox.width - outW) / 2);
      const outY = Math.round(sceneBox.y + (sceneBox.height - outH) / 2);

      dispatch(
        finishLottieGenerator({
          nodeId,
          animationData,
          genPrompt: text,
          name: text,
          width: outW,
          height: outH,
          x: outX,
          y: outY,
        })
      );
    } catch (err: any) {
      if (ac.signal.aborted) return;
      const doc = (store.getState() as any).editor?.document;
      if (doc) {
        dispatch(setDocumentFromCanvas(clearImageProcessAttrs(doc, nodeId)));
      }
      message.error(getHttpErrorMessage(err, t('editor.tools.lottieGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!showComposer) return null;

  const composerLeft = sceneBox.x + sceneBox.width / 2;
  const composerTop =
    sceneBox.y +
    sceneBox.height +
    rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom);

  return (
    <>
    <WorldScreenChromeRoot
      left={composerLeft}
      top={composerTop}
      anchor="top"
      data-lottie-generator
      data-sel-toolbar
      data-scene-node-id={nodeId}
      className="pointer-events-auto z-[32] overflow-visible"
      {...chromePointer}
    >
      <div
        className={cn(
          'flex h-[200px] w-[500px] flex-col overflow-hidden',
          'rounded-2xl border border-[var(--line)] bg-[var(--surface)]',
          'shadow-[0_8px_28px_rgba(15,23,42,0.12)]'
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {attachments.map((att) => (
            <ComposerAttachmentChip
              key={att.key}
              attachment={att}
              disabled={disabled || sending}
              onRemove={removeContext}
            />
          ))}
          <Tooltip tip={t('editor.tools.lottieGenUpload')} placement="top">
            <button
              type="button"
              disabled={disabled || sending}
              aria-label={t('editor.tools.lottieGenUpload')}
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
                  const attached = await attachSelectionToLottieComposer({
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
                    dispatch(
                      startCanvasAttachPick({ target: pickTarget, accept: 'image' })
                    );
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
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onPickRef(e)}
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
            placeholder={t('editor.tools.lottieGenPlaceholder')}
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
              <DropdownPanel className="w-[min(22rem,calc(100vw-2rem))] p-3">
                <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                  {t('editor.tools.lottieSettings')}
                </p>
                <div onPointerDown={(e) => e.stopPropagation()}>
                  <LottieSettingsPanel
                    aspectRatio={aspectRatio}
                    duration={duration}
                    onAspectRatioChange={applyAspectToNode}
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
                    tab="design"
                    models={pickerModels}
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
                disabled={disabled || sending || !prompt.trim()}
                aria-label={t('editor.tools.lottieGenSubmit')}
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
            assetKinds={['image']}
          />
        </div>
      </FloatingPortal>
    ) : null}
    </>
  );
}

export default memo(LottieGeneratorCard);
