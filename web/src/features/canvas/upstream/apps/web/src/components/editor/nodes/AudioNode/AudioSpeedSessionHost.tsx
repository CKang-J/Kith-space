/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/AudioSpeedSessionHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Audio 变速 session — floating bar under the node (same shell as trim / video trim).
 * Confirm clones a sibling to the right with `audioSpeed` — source stays untouched.
 */
import { useEffect, useRef, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown, HiOutlineChevronUp, HiOutlineXMark } from 'react-icons/hi2';
import {
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
  RcbOverlayPortal,
} from '@recombyn-native/components/rcb';
import { SELECTION_TOOLBAR_BELOW_BOX_GAP_PX } from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
import { Slider, message } from '@recombyn-native/components/base';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  cloneAudioNodeSibling
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  closeAudioToolPanel,
  setDocument,
  setSelectedNodeId,
  setSelectedNodeIds,
  EMPTY_ID_LIST,
} from '@recombyn-native/store/modules/editor';
import { getAudioHost } from './AudioNodeOverlay';

const MIN_SPEED = 0.1;
const MAX_SPEED = 4;
const STEP = 0.05;

function clampSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(n * 100) / 100));
}

function AudioSpeedSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { zoom } = useRcbCamera();
  const panel = useSelector(
    (s: any) => s.editor.audioToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const open = panel?.kind === 'speed';
  const nodeId = open ? panel!.nodeId : '';
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const src = String(node?.attrs?.src || '').trim();
  const sourceSpeedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [draft, setDraft] = useState('1.00');
  const [busy, setBusy] = useState(false);

  const close = () => {
    // Drop live preview — source node keeps its committed speed.
    getAudioHost(nodeId)?.setSpeed(sourceSpeedRef.current);
    dispatch(closeAudioToolPanel());
  };

  useEffect(() => {
    if (!open) return;
    if (!node || node.key !== 'audio' || !src) {
      close();
      return;
    }
    if (selectedNodeIds.length !== 1 || selectedNodeIds[0] !== nodeId) {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId, node, src, selectedNodeIds]);

  useEffect(() => {
    if (!open || !node) return;
    const committed = clampSpeed(node.attrs?.audioSpeed ?? 1);
    sourceSpeedRef.current = committed;
    setSpeed(committed);
    setDraft(committed.toFixed(2));
    getAudioHost(nodeId)?.setSpeed(committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId]);

  const { left, top } = node ? nodeLeftTop(document, node) : { left: 0, top: 0 };
  const width = Math.max(1, Number(node?.width) || 1);
  const height = Math.max(1, Number(node?.height) || 1);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: left + width / 2,
    top:
      top +
      height +
      rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX + 5, zoom),
    anchor: 'top',
  });

  const applyLive = (next: number) => {
    const v = clampSpeed(next);
    setSpeed(v);
    setDraft(v.toFixed(2));
    getAudioHost(nodeId)?.setSpeed(v);
  };

  const confirm = () => {
    if (!nodeId || !node || node.key !== 'audio' || busy) return;
    const v = clampSpeed(speed);
    // Same rate as source → nothing to spawn.
    if (Math.abs(v - sourceSpeedRef.current) < 0.001) {
      close();
      return;
    }

    setBusy(true);
    try {
      const spawned = cloneAudioNodeSibling(document, node, {
        attrsPatch: { audioSpeed: v },
        defaultName: t('editor.audioToolbar.speedResultName', {
          defaultValue: '变速音频',
        }),
      });
      if (!spawned) throw new Error('clone failed');
      getAudioHost(nodeId)?.setSpeed(sourceSpeedRef.current);
      dispatch(setDocument(spawned.document));
      dispatch(setSelectedNodeIds([spawned.id]));
      dispatch(setSelectedNodeId(spawned.id));
      dispatch(closeAudioToolPanel());
    } catch (err) {
      console.warn('[audio speed confirm]', err);
      message.error(
        t('editor.audioToolbar.speedFail', { defaultValue: '变速失败，请重试' })
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open || !node || !src) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-audio-speed-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[80]"
        style={toolbarStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.nativeEvent as any).stopImmediatePropagation?.();
        }}
      >
        <FloatingToolbar className="relative gap-2.5 py-1.5 px-2.5">
          <button
            type="button"
            aria-label={t('editor.audioToolbar.cancel', { defaultValue: '关闭' })}
            disabled={busy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--rail)]"
            onClick={close}
          >
            <HiOutlineXMark className="h-4 w-4" strokeWidth={2} />
          </button>
          <span className="text-[12px] font-medium text-[var(--ink)]">
            {t('editor.audioToolbar.speed', { defaultValue: '变速' })}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-[var(--muted)]">0.1x</span>
            <div
              className="h-8 w-[96px]"
              aria-label={t('editor.audioToolbar.speed', { defaultValue: '变速' })}
            >
              <Slider
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={STEP}
                value={speed}
                onChange={applyLive}
                trackHeight={4}
                thumbWidth={14}
                thumbHeight={14}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[var(--muted)]">4.0x</span>
          </div>
          <div className="inline-flex h-8 items-center gap-0.5 rounded-xl bg-[var(--rail)] pl-2.5 pr-1">
            <input
              value={`${draft}x`}
              onChange={(e) => {
                const raw = e.target.value.replace(/x$/i, '').trim();
                setDraft(raw);
                const n = Number(raw);
                if (Number.isFinite(n)) applyLive(n);
              }}
              onBlur={() => {
                const v = clampSpeed(Number(draft));
                applyLive(v);
              }}
              className="w-[3.4rem] bg-transparent text-[12px] tabular-nums text-[var(--ink)] outline-none"
            />
            <span className="flex flex-col">
              <button
                type="button"
                className="inline-flex h-3.5 w-5 items-center justify-center text-[var(--muted)] hover:text-[var(--ink)]"
                onClick={() => applyLive(speed + STEP)}
                aria-label="increase speed"
              >
                <HiOutlineChevronUp className="h-3 w-3" strokeWidth={2} />
              </button>
              <button
                type="button"
                className="inline-flex h-3.5 w-5 items-center justify-center text-[var(--muted)] hover:text-[var(--ink)]"
                onClick={() => applyLive(speed - STEP)}
                aria-label="decrease speed"
              >
                <HiOutlineChevronDown className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-label={t('editor.audioToolbar.generate', { defaultValue: '生成' })}
            className="inline-flex h-8 min-w-[52px] items-center justify-center rounded-xl bg-[var(--ink)] px-3 text-[12px] font-medium text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-50"
            onClick={confirm}
          >
            {busy ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              t('editor.audioToolbar.generate', { defaultValue: '生成' })
            )}
          </button>
        </FloatingToolbar>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(AudioSpeedSessionHost);
