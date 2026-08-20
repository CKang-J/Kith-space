/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/camera/context.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { createContext, useCallback, useContext, useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { rcbSceneToScreen, rcbScreenToScene } from '../core/math';
import { RCB_DEFAULT_CAMERA, type RcbCamera, type RcbVec } from '../core/types';

export const RcbCameraContext = createContext<RcbCamera>(RCB_DEFAULT_CAMERA);
export const RcbOverlayRootContext = createContext<HTMLElement | null>(null);
export const RcbViewportElContext = createContext<HTMLElement | null>(null);
/** Live `window.devicePixelRatio` (browser zoom). Camera pan snaps to this. */
export const RcbDevicePixelRatioContext = createContext(1);

/** Camera interaction: pan/zoom in flight → use efficientZoom for cull/LOD. */
export type RcbCameraMotion = {
  moving: boolean;
  /** Stepped while moving; equals live zoom when idle. */
  efficientZoom: number;
};

export const RcbCameraMotionContext = createContext<RcbCameraMotion>({
  moving: false,
  efficientZoom: RCB_DEFAULT_CAMERA.zoom,
});

export function useRcbCamera(): RcbCamera {
  return useContext(RcbCameraContext);
}

export function useRcbCameraMotion(): RcbCameraMotion {
  return useContext(RcbCameraMotionContext);
}

export function useRcbOverlayRoot(): HTMLElement | null {
  return useContext(RcbOverlayRootContext);
}

export function useRcbViewportEl(): HTMLElement | null {
  return useContext(RcbViewportElContext);
}

/** Live browser devicePixelRatio (updates on browser zoom). */
export function useRcbDevicePixelRatio(): number {
  return useContext(RcbDevicePixelRatioContext);
}

/** Pointer helper: `toScene(clientX, clientY)` using camera + viewport + DPR. */
export function useRcbScreenToScene(): (clientX: number, clientY: number) => RcbVec {
  const camera = useRcbCamera();
  const viewportEl = useRcbViewportEl();
  const dpr = useRcbDevicePixelRatio();
  return useCallback(
    (clientX: number, clientY: number) => {
      if (!viewportEl) return { x: 0, y: 0 };
      return rcbScreenToScene(camera, viewportEl, clientX, clientY, dpr);
    },
    [camera, viewportEl, dpr]
  );
}

/** Scene-anchored toolbar style in unscaled screen space. */
export function useRcbScreenToolbarStyle(opts: {
  left: number;
  top: number;
  anchor?: 'bottom' | 'top';
}): CSSProperties {
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const { x, y } = rcbSceneToScreen(camera, opts.left, opts.top, dpr);
  const anchor = opts.anchor ?? 'bottom';
  return useMemo(
    () => ({
      position: 'absolute' as const,
      left: x,
      top: y,
      transform: anchor === 'bottom' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
      transformOrigin: anchor === 'bottom' ? 'center bottom' : 'center top',
    }),
    [x, y, anchor]
  );
}

/** Portal children into the unscaled overlay layer. */
function RcbOverlayPortal({ children }: { children: ReactNode }) {
  const root = useRcbOverlayRoot();
  if (!root) return null;
  return createPortal(children, root);
}

const MemoizedRcbOverlayPortal = memo(RcbOverlayPortal);
export { MemoizedRcbOverlayPortal as RcbOverlayPortal };
