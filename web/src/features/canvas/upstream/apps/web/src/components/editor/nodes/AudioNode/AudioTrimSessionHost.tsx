/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/AudioTrimSessionHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Audio 截取 session — compact bar matching product mock:
 * [X] 截取  [00:00 - 00:01]  [生成]
 * Confirm clones a sibling with trimStart/trimEnd (same src) — video trim pattern.
 */
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import {
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
  RcbOverlayPortal,
} from '@recombyn-native/components/rcb';
import { SELECTION_TOOLBAR_BELOW_BOX_GAP_PX } from '@recombyn-native/components/rcb/selection/chrome/SelectionToolbarShell';
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
import { message } from '@recombyn-native/components/base';
import { getAudioHost } from './AudioNodeOverlay';

function saneDuration(value: unknown): number | null {
  const d = Number(value);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d > 60 * 60 * 12) return null;
  return d;
}

function clampRange(start: number, end: number, duration: number) {
  const d = saneDuration(duration) ?? 0.1;
  let a = Math.max(0, Math.min(Number.isFinite(start) ? start : 0, d));
  let b = Math.max(0, Math.min(Number.isFinite(end) ? end : d, d));
  if (b - a < 0.1) {
    if (a + 0.1 <= d) b = a + 0.1;
    else a = Math.max(0, b - 0.1);
  }
  return { start: a, end: b };
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function parseClock(text: string): number | null {
  const raw = String(text || '').trim();
  const m = raw.match(/^(\d{1,3}):(\d{1,2})$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec >= 60) return null;
  return min * 60 + sec;
}

function AudioTrimSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { zoom } = useRcbCamera();
  const panel = useSelector(
    (s: any) =>
      s.editor.audioToolPanel as null | {
        nodeId: string;
        kind: string;
        keepTime?: number;
      }
  );
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const open = panel?.kind === 'trim';
  const nodeId = open ? panel!.nodeId : '';
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const src = String(node?.attrs?.src || '').trim();
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState('00:00');
  const [endText, setEndText] = useState('00:01');
  const [busy, setBusy] = useState(false);

  const close = () => dispatch(closeAudioToolPanel());

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
    const known = saneDuration(node.attrs?.duration);
    const host = getAudioHost(nodeId);
    const live = saneDuration(host?.getAudio()?.duration);
    const d = known || live || 1;
    setDuration(d);
    const attrStart = Number(node.attrs?.trimStart);
    const attrEnd = Number(node.attrs?.trimEnd);
    const keep = Number(panel?.keepTime);
    let start = Number.isFinite(attrStart) ? attrStart : 0;
    let end = Number.isFinite(attrEnd) && attrEnd > start ? attrEnd : Math.min(d, start + 1);
    if (!Number.isFinite(attrStart) && Number.isFinite(keep) && keep >= 0) {
      start = Math.max(0, Math.min(keep, Math.max(0, d - 0.1)));
      end = Math.min(d, start + Math.min(1, d));
    }
    const next = clampRange(start, end, d);
    setStartText(formatClock(next.start));
    setEndText(formatClock(next.end));
    host?.seek(next.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId, src]);

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

  const rangeLabel = useMemo(() => `${startText} - ${endText}`, [startText, endText]);

  const confirm = () => {
    if (!nodeId || !src || busy || !node || node.key !== 'audio') return;
    const start = parseClock(startText);
    const end = parseClock(endText);
    if (start == null || end == null) {
      message.warning(
        t('editor.audioToolbar.trimInvalid', { defaultValue: '时间格式无效' })
      );
      return;
    }
    const next = clampRange(start, end, duration || end + 0.1);
    if (next.end - next.start < 0.05) {
      message.warning(
        t('editor.audioToolbar.trimTooShort', { defaultValue: '截取区间太短' })
      );
      return;
    }
    const d = saneDuration(duration);
    const isFull =
      Boolean(d) && next.start <= 0.02 && next.end >= (d as number) - 0.02;
    if (isFull) {
      close();
      return;
    }

    setBusy(true);
    try {
      const spawned = cloneAudioNodeSibling(document, node, {
        attrsPatch: { trimStart: next.start, trimEnd: next.end },
        defaultName: t('editor.audioToolbar.trimResultName', {
          defaultValue: '截取音频',
        }),
      });
      if (!spawned) throw new Error('clone failed');
      dispatch(setDocument(spawned.document));
      dispatch(setSelectedNodeIds([spawned.id]));
      dispatch(setSelectedNodeId(spawned.id));
      close();
    } catch (err) {
      console.warn('[audio trim confirm]', err);
      message.error(t('editor.audioToolbar.trimFail', { defaultValue: '截取失败，请重试' }));
    } finally {
      setBusy(false);
    }
  };

  if (!open || !node || !src) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-audio-trim-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[80]"
        style={toolbarStyle}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.nativeEvent as any).stopImmediatePropagation?.();
        }}
      >
        <FloatingToolbar className="relative gap-2 py-1.5 px-2.5">
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
            {t('editor.audioToolbar.trim', { defaultValue: '截取' })}
          </span>
          <div className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--rail)] px-2.5 text-[12px] tabular-nums text-[var(--ink)]">
            <input
              aria-label="trim start"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={() => {
                const n = parseClock(startText);
                if (n == null) setStartText(formatClock(0));
                else setStartText(formatClock(n));
              }}
              className="w-[3.25rem] bg-transparent text-center outline-none"
            />
            <span className="opacity-50">-</span>
            <input
              aria-label="trim end"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={() => {
                const n = parseClock(endText);
                if (n == null) setEndText(formatClock(1));
                else setEndText(formatClock(n));
              }}
              className="w-[3.25rem] bg-transparent text-center outline-none"
            />
            <span className="sr-only">{rangeLabel}</span>
          </div>
          <button
            type="button"
            disabled={busy}
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

export default memo(AudioTrimSessionHost);
