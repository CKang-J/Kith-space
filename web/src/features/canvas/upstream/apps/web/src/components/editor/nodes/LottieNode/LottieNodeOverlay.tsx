/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/LottieNode/LottieNodeOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Lottie ink portals into the node’s SVG foreignObject mount so paint order
 * follows shared `stackOrder` / `data-z` (same as images & generators).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import lottie, { type AnimationItem } from 'lottie-web';
import { useRcbCamera } from '@recombyn-native/components/rcb';
import {
  isLottieNode,
  isNodeHidden
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  parseLottieAnimationData,
  resolveThemeSurfaceFill
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { radiiFromAttrs } from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { useHtmlMediaMount } from '@recombyn-native/components/editor/nodes/useHtmlMediaMount';

export type LottieGeomOverride = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
};

export type LottieHostApi = {
  play: () => void;
  pause: () => void;
  isPaused: () => boolean;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  getSpeed: () => number;
};

const lottieHosts = new Map<string, LottieHostApi>();

export function getLottieHost(nodeId: string): LottieHostApi | null {
  return lottieHosts.get(nodeId) || null;
}

function readNodeAngle(node: SceneNodeInput) {
  const n = Number(node?.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

function plateTransform(angle: number) {
  if (Math.abs(angle) > 0.001) return `rotate(${angle}deg)`;
  return undefined;
}

function readLoop(attrs: any): boolean {
  const raw = attrs?.lottieLoop;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return true;
}

function readSpeed(attrs: any): number {
  const n = Number(attrs?.lottieSpeed);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

function LottieZoomSync({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useRcbCamera().zoom;
  useEffect(() => {
    onZoom(Math.max(0.05, zoom || 1));
  }, [zoom, onZoom]);
  return null;
}

function resolveLottiePlateFill(raw: string): string {
  const s = String(raw || '').trim();
  // Default / legacy transparent → theme surface plate (not black).
  if (!s || s === 'transparent') return resolveThemeSurfaceFill('');
  return resolveThemeSurfaceFill(s);
}

function LottiePlate({
  nodeId,
  scenePlate,
  animationJson,
  loop,
  speed,
  plateFill,
  hidden,
  mount,
}: {
  nodeId: string;
  scenePlate: CSSProperties & { left: number; top: number; width: number; height: number };
  animationJson: string;
  loop: boolean;
  speed: number;
  plateFill: string;
  hidden?: boolean;
  mount: HTMLElement;
}) {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const fill = resolveLottiePlateFill(plateFill);

  useEffect(() => {
    const host = hostEl;
    if (!host) return undefined;
    const data = parseLottieAnimationData(animationJson);
    if (!data) return undefined;
    host.innerHTML = '';
    let anim: AnimationItem;
    try {
      anim = lottie.loadAnimation({
        container: host,
        // SVG renderer: canvas missed some LLM path/group fills (blank heart).
        // FO + CSS zoom scale still works for path ink; dock/lightbox also use SVG.
        renderer: 'svg',
        loop,
        autoplay: true,
        animationData: structuredClone
          ? structuredClone(data)
          : JSON.parse(JSON.stringify(data)),
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: false,
          viewBoxOnly: false,
        },
      });
    } catch (err) {
      console.warn('[lottie] load failed', err);
      return undefined;
    }
    anim.setSpeed(speed);
    animRef.current = anim;
    const api: LottieHostApi = {
      play: () => anim.play(),
      pause: () => anim.pause(),
      isPaused: () => Boolean(anim.isPaused),
      setLoop: (next) => {
        anim.loop = next;
      },
      setSpeed: (next) => anim.setSpeed(next),
      getSpeed: () => Number(anim.playSpeed) || 1,
    };
    lottieHosts.set(nodeId, api);
    return () => {
      anim.destroy();
      animRef.current = null;
      if (lottieHosts.get(nodeId) === api) lottieHosts.delete(nodeId);
      host.innerHTML = '';
    };
    // loop/speed applied below — avoid remounting on toolbar toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [hostEl, animationJson, nodeId]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    anim.loop = loop;
  }, [loop]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    anim.setSpeed(speed);
  }, [speed]);

  return createPortal(
    <div
      data-lottie-node={nodeId}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        borderRadius: scenePlate.borderRadius,
        background: fill,
        boxShadow: fill === 'transparent' ? undefined : 'inset 0 0 0 1px var(--line)',
        visibility: hidden ? 'hidden' : undefined,
      }}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{
          width: scenePlate.width * z,
          height: scenePlate.height * z,
          transform: `scale(${1 / z})`,
          transformOrigin: '0 0',
        }}
      >
        <div ref={setHostEl} className="h-full w-full" />
      </div>
    </div>,
    mount
  );
}

function LottieNodeOverlay({
  document,
  hidden,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, LottieGeomOverride> | null;
}): ReactNode {
  const [zoom, setZoom] = useState(1);
  const onZoom = useCallback((z: number) => {
    setZoom((prev) => (Math.abs(prev - z) < 1e-6 ? prev : z));
  }, []);
  void zoom;

  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      if (!isLottieNode(node)) return false;
      return Boolean(parseLottieAnimationData(node?.attrs?.animationData));
    });
  }, [document]);

  if (!ids.length) return null;

  return (
    <>
      <LottieZoomSync onZoom={onZoom} />
      {ids.map((nodeId) => (
        <LottiePlateHost
          key={nodeId}
          nodeId={nodeId}
          document={document}
          hidden={hidden}
          geometryOverrides={geometryOverrides}
        />
      ))}
    </>
  );
}

function LottiePlateHost({
  nodeId,
  document,
  hidden,
  geometryOverrides,
}: {
  nodeId: string;
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, LottieGeomOverride> | null;
}) {
  const mount = useHtmlMediaMount(nodeId);
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || !mount) return null;
  const animationJson = String(node.attrs?.animationData || '').trim();
  if (!parseLottieAnimationData(animationJson)) return null;
  const layerHidden = isNodeHidden(node);
  const { left, top } = nodeLeftTop(document, node);
  const ov = geometryOverrides?.[nodeId];
  const width = Math.max(1, ov ? ov.width : Number(node.width) || 1);
  const height = Math.max(1, ov ? ov.height : Number(node.height) || 1);
  const angle = ov && Number.isFinite(ov.angle) ? Number(ov.angle) : readNodeAngle(node);
  const radii = radiiFromAttrs(node.attrs || {});
  const scenePlate: CSSProperties & {
    left: number;
    top: number;
    width: number;
    height: number;
  } = {
    left: ov ? ov.left : left,
    top: ov ? ov.top : top,
    width,
    height,
    borderRadius: `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`,
    transform: plateTransform(angle),
    transformOrigin: 'center center',
  };
  return (
    <LottiePlate
      nodeId={nodeId}
      scenePlate={scenePlate}
      animationJson={animationJson}
      loop={readLoop(node.attrs)}
      speed={readSpeed(node.attrs)}
      plateFill={String(node.attrs?.['fill-color'] || node.attrs?.fill || '').trim()}
      hidden={Boolean(hidden) || layerHidden}
      mount={mount}
    />
  );
}

export default memo(LottieNodeOverlay);
