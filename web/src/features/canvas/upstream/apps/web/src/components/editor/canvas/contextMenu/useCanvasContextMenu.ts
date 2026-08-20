/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/contextMenu/useCanvasContextMenu.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useDispatch } from 'react-redux';
import { rcbResolveViewportEl, type RcbCamera } from '@recombyn-native/components/rcb';
import type { ContextMenuState } from '@recombyn-native/components/rcb/selection/chrome/CanvasContextMenu';
import {
  setActiveFrameId,
  setSelectedNodeId,
  setSelectedNodeIds,
} from '@recombyn-native/store/modules/editor';
import { pointerToWorld, type ArtboardRect } from '../pointerToWorld';

type UseCanvasContextMenuArgs = {
  readOnly: boolean;
  camera: RcbCamera;
  artboard?: ArtboardRect;
  viewportEl: HTMLElement | null;
  stageEl: HTMLElement | null;
  paperEl: HTMLElement | null;
  documentRef: RefObject<any>;
  selectedIdsRef: RefObject<string[]>;
  selectedFrameIdsRef: RefObject<string[]>;
  activeFrameIdRef: RefObject<string | null>;
  hitTest: (
    x: number,
    y: number,
    opts?: { clientX?: number; clientY?: number }
  ) => string | null;
  setCtxMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_PX = 10;
/** Open on pointercancel only if held long enough (ignore scroll aborts). */
const CANCEL_OPEN_MIN_MS = 400;
const OPEN_DEBOUNCE_MS = 400;

const CHROME_SKIP_SEL =
  '[data-sel-toolbar],[data-frame-toolbar],[data-ctx-menu],[data-export-panel],[data-image-label],[data-frame-label],[data-crop-expand-overlay],[data-crop-expand-toolbar],[data-image-tool-panel],[data-text-inline-editor],[data-video-trim-toolbar],[data-video-playback-bar],[data-audio-playback-bar],[data-audio-trim-toolbar],[data-audio-speed-toolbar]';
const SCENE_COMPOSER_SEL =
  '[data-image-generator],[data-video-generator],[data-image-quick-edit]';
/** Account / settings / any Headless UI dialog — portaled over the canvas. */
const OVERLAY_UI_SEL =
  '[role="dialog"],[data-headlessui-portal],[data-account-settings],[data-rcb-overlay]';

type LongPress = {
  pointerId: number;
  x: number;
  y: number;
  target: EventTarget | null;
  startedAt: number;
};

function isBogusClient(clientX: number, clientY: number) {
  return (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    (clientX <= 2 && clientY <= 2)
  );
}

function prefersCoarsePointer() {
  if (typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(any-pointer: coarse)').matches
  );
}

function isTouchLikePointer(e: PointerEvent, coarse: boolean) {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true;
  return e.button === 0 && coarse;
}

function isChromeTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest(SCENE_COMPOSER_SEL)) return false;
  return Boolean(el.closest(CHROME_SKIP_SEL));
}

/** Settings modal / floating UI above the board — must not open the canvas menu. */
function isOverlayUiTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return Boolean(el.closest(OVERLAY_UI_SEL));
}

function clientInElement(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return (
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom
  );
}

function stageContainsTarget(stage: HTMLElement, target: EventTarget | null) {
  const node = target as Node | null;
  if (!node) return false;
  return node === stage || stage.contains(node);
}

/**
 * Canvas menu only for presses that actually hit the stage tree.
 * Coords alone are wrong when a portaled dialog sits over the board.
 */
function isCanvasGestureTarget(hitEl: HTMLElement, target: EventTarget | null) {
  if (isOverlayUiTarget(target) || isChromeTarget(target)) return false;
  return stageContainsTarget(hitEl, target);
}

function findFrameIdAtScene(
  frames: any[] | undefined,
  sceneX: number,
  sceneY: number
): string | null {
  if (!Array.isArray(frames)) return null;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (!f || f.hidden) continue;
    const fx = Number(f.x) || 0;
    const fy = Number(f.y) || 0;
    const fw = Math.max(1, Number(f.width) || 1);
    const fh = Math.max(1, Number(f.height) || 1);
    if (sceneX >= fx && sceneX <= fx + fw && sceneY >= fy && sceneY <= fy + fh) {
      return String(f.id);
    }
  }
  return null;
}

/**
 * Canvas context menu — driven only by our pointer gestures (not browser
 * `contextmenu`, whose coords are often 0/1 on touch). Native menu is suppressed.
 *
 * - mouse right button → open on pointerdown/mousedown
 * - touch / coarse → long-press at down position
 * - pointercancel after a long hold → open (browser stole the gesture)
 */
export function useCanvasContextMenu(args: UseCanvasContextMenuArgs) {
  const {
    readOnly,
    camera,
    artboard,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    hitTest,
    setCtxMenu,
  } = args;
  const dispatch = useDispatch();

  const openedAtRef = useRef(0);
  const cameraRef = useRef(camera);
  const artboardRef = useRef(artboard);
  const hitTestRef = useRef(hitTest);
  const viewportElRef = useRef(viewportEl);
  const stageElRef = useRef(stageEl);
  const paperElRef = useRef(paperEl);
  cameraRef.current = camera;
  artboardRef.current = artboard;
  hitTestRef.current = hitTest;
  viewportElRef.current = viewportEl;
  stageElRef.current = stageEl;
  paperElRef.current = paperEl;

  useEffect(() => {
    const hitEl = rcbResolveViewportEl(viewportEl, stageEl, paperEl);
    if (readOnly || !hitEl) return undefined;

    const coarse = prefersCoarsePointer();
    let longPressTimer: number | null = null;
    let longPress: LongPress | null = null;

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPress = null;
    };

    const openMenuAt = (clientX: number, clientY: number) => {
      const p = pointerToWorld(
        cameraRef.current,
        {
          viewportEl: viewportElRef.current,
          stageEl: stageElRef.current,
          paperEl: paperElRef.current,
          artboard: artboardRef.current,
        },
        clientX,
        clientY
      );
      const id = hitTestRef.current(p.x, p.y, { clientX, clientY });
      const selected = selectedIdsRef.current;
      if (id && !selected.includes(id)) {
        dispatch(setSelectedNodeIds([id]));
        dispatch(setSelectedNodeId(id));
      }

      let frameId: string | null = activeFrameIdRef.current;
      if (!id) {
        const hitFrameId = findFrameIdAtScene(documentRef.current?.frames, p.x, p.y);
        if (hitFrameId) {
          frameId = hitFrameId;
          if (!selected.length && !selectedFrameIdsRef.current.includes(hitFrameId)) {
            dispatch(setActiveFrameId(hitFrameId));
            dispatch(setSelectedNodeIds([]));
            dispatch(setSelectedNodeId(null));
          }
        }
      }

      const nodeId = id || (selected.length === 1 ? selected[0] : null);
      setCtxMenu({
        clientX,
        clientY,
        sceneX: p.x,
        sceneY: p.y,
        nodeId,
        frameId,
      });
    };

    let lastOpenX = 0;
    let lastOpenY = 0;
    const tryOpen = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (
        performance.now() - openedAtRef.current < OPEN_DEBOUNCE_MS &&
        Math.hypot(clientX - lastOpenX, clientY - lastOpenY) < 12
      ) {
        return;
      }
      if (isBogusClient(clientX, clientY)) return;
      if (!clientInElement(hitEl, clientX, clientY)) return;
      if (!isCanvasGestureTarget(hitEl, target)) return;
      openedAtRef.current = performance.now();
      lastOpenX = clientX;
      lastOpenY = clientY;
      openMenuAt(clientX, clientY);
    };

    const startLongPress = (
      pointerId: number,
      x: number,
      y: number,
      target: EventTarget | null
    ) => {
      clearLongPress();
      longPress = { pointerId, x, y, target, startedAt: performance.now() };
      longPressTimer = window.setTimeout(() => {
        const lp = longPress;
        clearLongPress();
        if (!lp) return;
        tryOpen(lp.x, lp.y, lp.target);
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!longPress || longPress.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_MOVE_PX) {
        clearLongPress();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // Dialog / dock / chrome — never steal right-click from overlay UI.
      if (!isCanvasGestureTarget(hitEl, e.target)) {
        clearLongPress();
        return;
      }
      if (isBogusClient(e.clientX, e.clientY) || !clientInElement(hitEl, e.clientX, e.clientY)) {
        clearLongPress();
        return;
      }

      if (e.button === 2) {
        clearLongPress();
        e.preventDefault();
        e.stopPropagation();
        tryOpen(e.clientX, e.clientY, e.target);
        return;
      }

      if (e.button !== 0 || !isTouchLikePointer(e, coarse)) return;
      startLongPress(e.pointerId, e.clientX, e.clientY, e.target);
    };

    /** Some hybrid drivers skip PointerEvent button=2 but still fire MouseEvent. */
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (!isCanvasGestureTarget(hitEl, e.target)) return;
      if (isBogusClient(e.clientX, e.clientY) || !clientInElement(hitEl, e.clientX, e.clientY)) {
        return;
      }
      clearLongPress();
      e.preventDefault();
      e.stopPropagation();
      tryOpen(e.clientX, e.clientY, e.target);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (longPress && e.pointerId === longPress.pointerId) clearLongPress();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!longPress) return;
      if (longPress.pointerId !== e.pointerId && longPress.pointerId !== -1) return;
      const lp = longPress;
      const held = performance.now() - lp.startedAt;
      clearLongPress();
      if (held < CANCEL_OPEN_MIN_MS) return;
      tryOpen(lp.x, lp.y, lp.target);
    };

    /** Suppress native menu only on the stage / canvas chrome — not on settings dialogs. */
    const onContextMenu = (e: MouseEvent) => {
      if (!stageContainsTarget(hitEl, e.target) && !isChromeTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      clearLongPress();
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [
    activeFrameIdRef,
    dispatch,
    documentRef,
    paperEl,
    readOnly,
    selectedFrameIdsRef,
    selectedIdsRef,
    setCtxMenu,
    stageEl,
    viewportEl,
  ]);
}
