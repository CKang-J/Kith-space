/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/flyToChat.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { getRecombynPortalRoot } from '@/features/canvas/adapters/recombynFloatingUi';
/**
 * Shared canvas → Agent composer fly-in (mark regions, 添加到 Chat, Add from canvas).
 * Arc path via CSS offset-path; imperative so pick / context-menu can fire without React state.
 */
import { CONTEXT_CHIP_PILL_CLASS } from '@recombyn-native/components/editor/panels/AgentComposerInput';
import { rcbSceneToScreen, type RcbCamera } from '@recombyn-native/components/rcb';
import {
  getInfiniteSvgPaintCamera,
  nodeLeftTop,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import { cn } from '@recombyn-native/utils/classnames';

export const FLY_CHIP_MS = 640;
export const FLY_CHIP_LAND_AT = Math.round(FLY_CHIP_MS * 0.78);

const CHIP_W = 112;
const CHIP_H = 28;

type Point = { x: number; y: number };

/** Last pointer / selection origin for the next attach → chat fly (client / fixed). */
let pendingFlyOrigin: Point | null = null;
/** Which composer should receive the chip (`agent` | `node:<id>`). */
let pendingFlyLandId: string | null = null;

export function noteCanvasFlyOrigin(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  pendingFlyOrigin = { x, y };
}

export function takeCanvasFlyOrigin(): Point | null {
  const p = pendingFlyOrigin;
  pendingFlyOrigin = null;
  return p;
}

/** Remember which input the next fly should land in (matches `data-fly-land`). */
export function noteCanvasFlyLand(landId: string) {
  const id = String(landId || '').trim();
  pendingFlyLandId = id || null;
}

export function takeCanvasFlyLand(): string | null {
  const id = pendingFlyLandId;
  pendingFlyLandId = null;
  return id;
}

function pointFromEl(el: HTMLElement | null): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 8 && r.height > 8)) return null;
  return { x: r.left + Math.min(72, r.width * 0.28), y: r.top + r.height * 0.45 };
}

/**
 * Landing point for a fly chip.
 * Prefer the composer that started pick (`data-fly-land`), never the first random
 * `[data-agent-composer]` (generator cards also use that attribute).
 */
export function resolveChatFlyTarget(opts?: { landId?: string | null }): Point {
  const landId = String(opts?.landId ?? pendingFlyLandId ?? '').trim();
  if (landId) {
    const scoped = globalThis.document.querySelector(
      `[data-fly-land="${landId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    ) as HTMLElement | null;
    const pt = pointFromEl(scoped);
    if (pt) return pt;
  }
  const agentLand = pointFromEl(
    globalThis.document.querySelector('[data-fly-land="agent"]') as HTMLElement | null
  );
  if (agentLand) return agentLand;

  const dock =
    (globalThis.document.querySelector('[data-tour="editor-agent"]') as HTMLElement | null) ||
    (globalThis.document.querySelector('aside[data-tour]') as HTMLElement | null);
  if (dock) {
    const composer = dock.querySelector(
      '[data-fly-land], [data-agent-composer-root], [data-agent-composer]'
    ) as HTMLElement | null;
    const pt = pointFromEl(composer) || pointFromEl(dock);
    if (pt) {
      if (!composer && dock) {
        const r = dock.getBoundingClientRect();
        return { x: r.left + r.width * 0.35, y: r.bottom - 96 };
      }
      return pt;
    }
  }
  return {
    x: Math.max(120, window.innerWidth - 220),
    y: Math.max(120, window.innerHeight * 0.62),
  };
}

/** Stage-local → `position:fixed` client coords. */
function stageLocalToClient(local: Point): Point {
  const stage =
    (globalThis.document.querySelector('[data-rcb-canvas]') as HTMLElement | null) ||
    (globalThis.document.querySelector('[data-rcb-overlay]') as HTMLElement | null);
  if (!stage) return local;
  const r = stage.getBoundingClientRect();
  return { x: local.x + r.left, y: local.y + r.top };
}

function sceneBoxCenterClient(
  document: SceneDocument,
  nodeId: string,
  camera: RcbCamera
): Point | null {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  const w = Math.max(1, Number(node.width) || 1);
  const h = Math.max(1, Number(node.height) || 1);
  const local = rcbSceneToScreen(camera, left + w / 2, top + h / 2);
  return stageLocalToClient(local);
}

/** Best-effort **client** origin for an attach payload (node / multi / frame). */
export function resolveAttachPayloadFlyOrigin(opts: {
  document: SceneDocument;
  payload: string | string[];
  camera: RcbCamera;
}): Point | null {
  const { document: doc, payload, camera } = opts;
  if (Array.isArray(payload)) {
    const pts = payload
      .map((id) => sceneBoxCenterClient(doc, String(id), camera))
      .filter(Boolean) as Point[];
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  const raw = String(payload || '');
  if (raw.startsWith('frame:')) {
    const frameId = raw.slice('frame:'.length);
    const frames = Array.isArray(doc?.frames) ? doc.frames : [];
    const frame = frames.find((f: { id?: string }) => f?.id === frameId);
    if (!frame) return null;
    const x = Number(frame.x) || 0;
    const y = Number(frame.y) || 0;
    const w = Math.max(1, Number(frame.width) || 1);
    const h = Math.max(1, Number(frame.height) || 1);
    const local = rcbSceneToScreen(camera, x + w / 2, y + h / 2);
    return stageLocalToClient(local);
  }
  return sceneBoxCenterClient(doc, raw, camera);
}

function quadraticPath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Arc bulges “up” on screen so left→right tosses feel thrown, not linear.
  const bulge = Math.min(160, Math.max(56, len * 0.34));
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - bulge;
  const fmt = (n: number) => n.toFixed(1);
  return `M ${fmt(from.x)} ${fmt(from.y)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(to.x)} ${fmt(to.y)}`;
}

function ensureFlyStyles() {
  const id = 'recombyn-fly-to-chat-css-2';
  if (globalThis.document.getElementById(id)) return;
  const style = globalThis.document.createElement('style');
  style.id = id;
  style.textContent = `
@keyframes recombyn-fly-chip-arc {
  0% {
    offset-distance: 0%;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.55) rotate(0deg);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  }
  12% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
  }
  55% {
    opacity: 1;
    box-shadow: 0 12px 32px rgba(59, 130, 246, 0.28);
  }
  100% {
    offset-distance: 100%;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.72) rotate(-6deg);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }
}`;
  globalThis.document.head.appendChild(style);
}

export type PlayFlyChipToChatOpts = {
  from: Point;
  to?: Point;
  /** Prefer this composer (`agent` | `node:<id>`); consumes pending land if omitted. */
  landId?: string | null;
  label?: string;
  thumbUrl?: string;
  /** Called near landing so the real chip can appear in the composer. */
  onLand?: () => void | Promise<void>;
  /** Pop-in hold before arc (ms). */
  popMs?: number;
};

/** Short label for the flying chip. */
export function resolveAttachFlyLabel(
  document: SceneDocument | null | undefined,
  payload: string | string[]
): string {
  if (Array.isArray(payload)) {
    if (payload.length > 1) return `${payload.length} items`;
    payload = payload[0] || '';
  }
  const raw = String(payload || '');
  if (raw.startsWith('frame:')) {
    const frameId = raw.slice('frame:'.length);
    const frames = Array.isArray(document?.frames) ? document!.frames : [];
    const frame = frames.find((f: { id?: string; name?: string }) => f?.id === frameId);
    return String(frame?.name || 'Frame').trim() || 'Frame';
  }
  const node = document?.deltaSetLike?.[raw];
  const name = String(node?.name || node?.attrs?.name || '').trim();
  if (name) return name.length > 18 ? `${name.slice(0, 17)}…` : name;
  if (node?.key) return String(node.key);
  return 'Chat';
}

/**
 * Imperative chip fly: pop at `from`, arc to composer (or `to`), then remove.
 * Resolves when the element is gone.
 */
export async function playFlyChipToChat(opts: PlayFlyChipToChatOpts): Promise<void> {
  if (typeof document === 'undefined') {
    opts.onLand?.();
    return;
  }
  ensureFlyStyles();
  const from = opts.from;
  const popMs = opts.popMs ?? 0;
  const label = String(opts.label || 'Chat').trim() || 'Chat';

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-fly-to-chat-chip', '1');
  el.className = cn(CONTEXT_CHIP_PILL_CLASS, 'pl-1 pr-2 ring-1 ring-sky-400/55');
  el.style.cssText = [
    'position:fixed',
    `left:${from.x}px`,
    `top:${from.y}px`,
    `width:${CHIP_W}px`,
    `height:${CHIP_H}px`,
    'z-index:9999',
    'pointer-events:none',
    'transform:translate(-50%,-50%)',
    'will-change:transform,opacity,offset-distance',
    'box-shadow:0 10px 28px rgba(15,23,42,0.2)',
    'opacity:0',
  ].join(';');

  if (opts.thumbUrl) {
    const img = document.createElement('img');
    img.src = opts.thumbUrl;
    img.alt = '';
    img.draggable = false;
    img.className =
      'h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--line)]';
    el.appendChild(img);
  } else {
    const badge = document.createElement('span');
    badge.className =
      'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-sky-100 text-[9px] font-semibold text-sky-700 ring-1 ring-sky-200';
    badge.textContent = '@';
    el.appendChild(badge);
  }
  const text = document.createElement('span');
  text.className = 'min-w-0 truncate';
  text.textContent = label;
  el.appendChild(text);

  getRecombynPortalRoot().appendChild(el);

  await new Promise<void>((r) => window.setTimeout(r, popMs));

  // Prefer explicit landId; always clear pending so a later fly can't steal the wrong box.
  const pendingLand = takeCanvasFlyLand();
  const landId = String(opts.landId ?? pendingLand ?? '').trim();
  const to = opts.to || resolveChatFlyTarget({ landId: landId || null });
  const path = quadraticPath(from, to);
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.offsetPath = `path('${path}')`;
  el.style.offsetAnchor = 'center';
  el.style.offsetRotate = '0deg';
  el.style.animation = `recombyn-fly-chip-arc ${FLY_CHIP_MS}ms cubic-bezier(0.22, 0.82, 0.2, 1) forwards`;

  await new Promise<void>((r) => window.setTimeout(r, FLY_CHIP_LAND_AT));
  try {
    await opts.onLand?.();
  } catch {
    /* ignore */
  }
  await new Promise<void>((r) => window.setTimeout(r, FLY_CHIP_MS + 80 - FLY_CHIP_LAND_AT));
  el.remove();
}

/**
 * Origin for the next fly chip (client / fixed coords).
 * Prefer attached node / frame center; else noted canvas pointer; else near land.
 */
export function resolveNextFlyOrigin(opts: {
  document?: SceneDocument | null;
  payload?: string | string[] | null;
  camera?: RcbCamera | null;
}): Point {
  const noted = takeCanvasFlyOrigin();
  const camera = opts.camera ?? getInfiniteSvgPaintCamera();
  if (opts.document && opts.payload != null && camera) {
    const fromPayload = resolveAttachPayloadFlyOrigin({
      document: opts.document,
      payload: opts.payload,
      camera,
    });
    if (fromPayload) return fromPayload;
  }
  if (noted) return noted;

  const land = resolveChatFlyTarget({ landId: null });
  return { x: land.x - 120, y: land.y + 40 };
}
