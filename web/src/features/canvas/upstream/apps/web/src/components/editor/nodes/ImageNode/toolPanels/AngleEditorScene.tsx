/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/AngleEditorScene.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import {
  HiOutlineChevronDown,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineChevronUp,
} from 'react-icons/hi2';
import { cn } from '@recombyn-native/utils/classnames';
import './AngleEditorScene.css';

export type AngleCubeScale = 1 | 5 | 10;
export type AngleEditorMode = 'skybox' | 'camera';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rotateMin = -90;
const rotateMax = 90;
/** Symmetric so 俯视 / 仰视 can reach the same strength. */
const tiltMin = -60;
const tiltMax = 60;
/** Arrow-button increments (sliders use 1°). */
const rotateStep = 5;
const tiltStep = 5;

const snapInt = (value: number, min: number, max: number) =>
  Math.round(clamp(value, min, max));

/** Longitude / latitude rings for the camera orbit globe (15° steps). */
const ORBIT_RING_Y_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] as const;
const ORBIT_RING_X_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] as const;

/** Camera sits on the globe surface (CSS globe = 150px → radius 75). */
const CAMERA_ORBIT_RADIUS = 75;
const CAMERA_SIGHT_LINE = 67;

const cubeScaleToVisualScale: Record<AngleCubeScale, number> = {
  1: 0.78,
  5: 0.88,
  10: 1,
};

/** Max edge for the face-on subject inside the 150px orbit globe (Mid ≈ this × 0.88). */
const SUBJECT_MAX_BOX = 64;

type Props = {
  mode: AngleEditorMode;
  rotate: number;
  tilt: number;
  cubeScale?: AngleCubeScale;
  imageSrc?: string;
  onRotateChange: (next: number) => void;
  onTiltChange: (next: number) => void;
  className?: string;
};

/** Skybox faces — image on the front only; other sides use direction letters. */
function SkyboxCubeFaces({ imageSrc }: { imageSrc?: string }): ReactNode {
  const face = (faceClass: string, fallback: string, withImage = false) => (
    <div
      className={cn(
        'rcb-angle-editor-cube-face',
        faceClass,
        withImage && imageSrc && 'rcb-has-image'
      )}
    >
      {withImage && imageSrc ? (
        <img className="rcb-angle-editor-face-image-content" alt="" src={imageSrc} draggable={false} />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
  return (
    <>
      {face('rcb-angle-editor-face-front', 'F', true)}
      {face('rcb-angle-editor-face-back', 'Bk')}
      {face('rcb-angle-editor-face-right', 'R')}
      {face('rcb-angle-editor-face-left', 'L')}
      {face('rcb-angle-editor-face-top', 'T')}
      {face('rcb-angle-editor-face-bottom', 'B')}
    </>
  );
}

/** Fit preview inside maxBox while keeping the source aspect ratio. */
function subjectBoxSize(
  naturalW: number,
  naturalH: number,
  maxBox = SUBJECT_MAX_BOX
): { width: number; height: number } {
  const w = Math.max(1, naturalW);
  const h = Math.max(1, naturalH);
  const scale = Math.min(maxBox / w, maxBox / h);
  return {
    width: Math.max(20, Math.round(w * scale)),
    height: Math.max(20, Math.round(h * scale)),
  };
}

/**
 * Multi-angle preview
 * - skybox: wireframe cube only
 * - camera: face-on center image + orbiting camera
 */
function AngleEditorScene({
  mode,
  rotate,
  tilt,
  cubeScale = 5,
  imageSrc,
  onRotateChange,
  onTiltChange,
  className,
}: Props): ReactNode {
  const cubeSize = 100;
  const half = cubeSize / 2;
  const visualScale = cubeScaleToVisualScale[cubeScale];
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setNaturalSize(null);
    if (!imageSrc) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0) setNaturalSize({ w, h });
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const subjectSize = useMemo(() => {
    if (!naturalSize) return { width: SUBJECT_MAX_BOX, height: SUBJECT_MAX_BOX };
    return subjectBoxSize(naturalSize.w, naturalSize.h, SUBJECT_MAX_BOX);
  }, [naturalSize]);

  const screenBgStyle = useMemo<CSSProperties | undefined>(() => {
    if (!imageSrc) return undefined;
    return {
      backgroundImage: `url("${imageSrc}")`,
      backgroundSize: 'contain',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }, [imageSrc]);

  const bumpRotate = (delta: number) =>
    onRotateChange(snapInt(rotate + delta, rotateMin, rotateMax));
  const bumpTilt = (delta: number) => onTiltChange(snapInt(tilt + delta, tiltMin, tiltMax));

  const sceneRef = useRef<HTMLDivElement>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; rotate: number; tilt: number } | null>(null);
  const onRotateRef = useRef(onRotateChange);
  const onTiltRef = useRef(onTiltChange);
  const modeRef = useRef(mode);
  onRotateRef.current = onRotateChange;
  onTiltRef.current = onTiltChange;
  modeRef.current = mode;
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return undefined;

    const onMove = (e: PointerEvent) => {
      if (dragPointerIdRef.current == null || e.pointerId !== dragPointerIdRef.current) return;
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      onRotateRef.current(snapInt(start.rotate + dx / 1.8, rotateMin, rotateMax));
      // Skybox rotates the cube (opposite of camera-orbit); match finger direction.
      const tiltDelta = modeRef.current === 'skybox' ? dy / 2.2 : -dy / 2.2;
      onTiltRef.current(snapInt(start.tilt + tiltDelta, tiltMin, tiltMax));
    };

    const onUp = (e: PointerEvent) => {
      if (dragPointerIdRef.current == null || e.pointerId !== dragPointerIdRef.current) return;
      const start = dragStartRef.current;
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        onRotateRef.current(snapInt(start.rotate + dx / 1.8, rotateMin, rotateMax));
        const tiltDelta = modeRef.current === 'skybox' ? dy / 2.2 : -dy / 2.2;
        onTiltRef.current(snapInt(start.tilt + tiltDelta, tiltMin, tiltMax));
      }
      dragPointerIdRef.current = null;
      dragStartRef.current = null;
      setIsDragging(false);
      const el = sceneRef.current;
      if (el?.hasPointerCapture?.(e.pointerId)) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.rcb-angle-editor-direction-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    dragPointerIdRef.current = e.pointerId;
    dragStartRef.current = { x: e.clientX, y: e.clientY, rotate, tilt };
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const cubeStyle: CSSProperties = {
    width: cubeSize,
    height: cubeSize,
    ...({ ['--angle-cube-half']: `${half}px` } as CSSProperties),
  };

  const dirBtns = (
    <>
      <button
        type="button"
        className="rcb-angle-editor-direction-btn rcb-angle-editor-direction-btn-up"
        aria-label="Tilt up"
        onClick={() => bumpTilt(tiltStep)}
      >
        <HiOutlineChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className="rcb-angle-editor-direction-btn rcb-angle-editor-direction-btn-down"
        aria-label="Tilt down"
        onClick={() => bumpTilt(-tiltStep)}
      >
        <HiOutlineChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className="rcb-angle-editor-direction-btn rcb-angle-editor-direction-btn-left"
        aria-label="Rotate left"
        onClick={() => bumpRotate(-rotateStep)}
      >
        <HiOutlineChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className="rcb-angle-editor-direction-btn rcb-angle-editor-direction-btn-right"
        aria-label="Rotate right"
        onClick={() => bumpRotate(rotateStep)}
      >
        <HiOutlineChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </>
  );

  if (mode === 'skybox') {
    // Wireframe cube only. Same orbit as camera mode — Front (0,0) is face-on.
    return (
      <div className={cn('rcb-angle-editor-scene', className)}>
        <div
          ref={sceneRef}
          className={cn('rcb-unified-scene', 'rcb-mode-skybox', isDragging && 'rcb-is-dragging')}
          style={{ perspective: 900 }}
          onPointerDown={handlePointerDown}
        >
          <div className="rcb-angle-editor-skybox-stage">
            <div className="rcb-angle-editor-scene-container" style={{ perspective: 900 }}>
              <div
                className="rcb-angle-editor-cube-wrapper"
                style={{
                  transition: isDragging ? 'none' : undefined,
                  // Invert tilt vs camera-orbit: +tilt = look down (俯视) for both modes.
                  transform: `scale(${visualScale}) rotateX(${-tilt}deg) rotateY(${rotate}deg)`,
                }}
              >
                <div className="rcb-angle-editor-cube" style={cubeStyle}>
                  <SkyboxCubeFaces imageSrc={imageSrc} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const cameraPositionTransform = `translateZ(${CAMERA_ORBIT_RADIUS}px) scale(1) rotateZ(0deg)`;
  const orbitGlobeStyle: CSSProperties = {
    transform: `rotateY(${rotate}deg) rotateX(${tilt}deg)`,
    transition: isDragging ? 'none' : 'transform 120ms ease-out',
  };

  return (
    <div className={cn('rcb-angle-editor-scene', className)}>
      <div
        ref={sceneRef}
        className={cn('rcb-unified-scene', 'rcb-mode-camera', isDragging && 'rcb-is-dragging')}
        style={{ perspective: 1200 }}
        onPointerDown={handlePointerDown}
      >
        {/* Fixed face-on subject: scales with zoom, never rotates with camera. */}
        <div className="rcb-unified-scene-cube-container" style={{ zIndex: 0 }}>
          <div
            className="rcb-angle-editor-fixed-subject"
            style={{
              width: subjectSize.width,
              height: subjectSize.height,
              transition: isDragging ? 'none' : 'transform 120ms ease-out',
              transform: `scale(${visualScale})`,
            }}
          >
            {imageSrc ? (
              <img
                className="rcb-angle-editor-fixed-subject-image"
                alt=""
                src={imageSrc}
                draggable={false}
              />
            ) : (
              <div className="rcb-angle-editor-fixed-subject-placeholder" />
            )}
          </div>
        </div>

        {/* Wireframe orbit globe — rotates with camera so rings stay a spatial reference. */}
        <div className="rcb-mae-orbit-globe" role="presentation" aria-hidden>
          <div className="rcb-mae-orbit-globe-core" style={orbitGlobeStyle}>
            {ORBIT_RING_Y_DEG.map((deg) => (
              <div
                key={`ring-y-${deg}`}
                className="rcb-mae-orbit-globe-ring"
                style={{ transform: `rotateY(${deg}deg)` }}
              />
            ))}
            {ORBIT_RING_X_DEG.map((deg) => (
              <div
                key={`ring-x-${deg}`}
                className="rcb-mae-orbit-globe-ring"
                style={{ transform: `rotateX(${deg}deg)` }}
              />
            ))}
          </div>
          <div className="rcb-mae-orbit-globe-axis" />
        </div>

        <div className="rcb-angle-editor-scene-camera">
          <div
            className="rcb-angle-editor-camera-3d-pivot"
            style={{
              transformStyle: 'preserve-3d',
              transform: `rotateX(${tilt}deg) rotateY(${rotate}deg)`,
            }}
          >
            <div
              className="rcb-angle-editor-camera-3d-position"
              style={{ transformStyle: 'preserve-3d', transform: cameraPositionTransform }}
            >
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-front"
                style={{ transform: 'translate(-50%, -50%) translateZ(-8px)' }}
              >
                <div className="rcb-angle-editor-camera-3d-lens-outer">
                  <div className="rcb-angle-editor-camera-3d-lens-inner" />
                </div>
              </div>
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-back"
                style={{ transform: 'translate(-50%, -50%) translateZ(8px)' }}
              >
                <div className="rcb-angle-editor-camera-3d-screen" style={screenBgStyle} />
              </div>
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-top"
                style={{ transform: 'translate(-50%, -50%) rotateX(90deg) translateZ(8.2px)' }}
              >
                <div className="rcb-angle-editor-camera-3d-shutter" />
              </div>
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-bottom"
                style={{ transform: 'translate(-50%, -50%) rotateX(-90deg) translateZ(8.2px)' }}
              />
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-side"
                style={{ transform: 'translate(-50%, -50%) rotateY(-90deg) translateZ(11px)' }}
              />
              <div
                className="rcb-angle-editor-camera-3d-body rcb-angle-editor-camera-3d-side"
                style={{ transform: 'translate(-50%, -50%) rotateY(90deg) translateZ(11px)' }}
              />
              <div
                className="rcb-angle-editor-camera-3d-hotshoe"
                style={{
                  left: '50%',
                  top: '50%',
                  transformStyle: 'preserve-3d',
                  transform: 'translate(-50%, -50%) translateY(-12px)',
                }}
              >
                <div
                  className="rcb-angle-editor-camera-3d-hotshoe-body"
                  style={{ transform: 'translateZ(2px)' }}
                >
                  <div className="rcb-angle-editor-camera-3d-hotshoe-mount" />
                </div>
              </div>
              <div
                className="rcb-angle-editor-camera-3d-line"
                style={{
                  height: CAMERA_SIGHT_LINE,
                  transform: 'translate(-50%, 0px) translateZ(-8px) rotateX(-90deg)',
                }}
              />
            </div>
          </div>
          <div className="rcb-mae-orbit-nav" aria-hidden={false}>
            {dirBtns}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(AngleEditorScene);
