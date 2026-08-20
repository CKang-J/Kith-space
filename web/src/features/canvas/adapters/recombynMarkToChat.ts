import { getActiveCanvasChatSurface } from "../host/canvasChatBridge";
import { requestCanvasSelectionToChat, type CanvasMarkedRegionInput } from "./recombynSelectionToChat";

export const KITH_CHAT_FLY_LAND_PREFIX = "kith-chat:";
export const KITH_COMPOSER_ATTACH_FILE_EVENT = "kith:composer-attach-file";

export interface ComposerAttachFileDetail {
  file?: File;
  caption?: string;
  surfaceId?: string | null;
}

export interface MarkedImageRegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
}

export interface MarkedImageRegionToChatInput {
  canvasId: string;
  nodeId: string;
  label: string;
  region: MarkedImageRegionBox;
  nodeWidth: number;
  nodeHeight: number;
  dataUrl?: string;
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unit01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

export function canvasMarkedRegionFromBox(
  nodeId: string,
  label: string,
  region: MarkedImageRegionBox,
  nodeWidth: number,
  nodeHeight: number,
): CanvasMarkedRegionInput {
  const width = Math.max(1, nodeWidth);
  const height = Math.max(1, nodeHeight);
  return {
    nodeId: nodeId.trim(),
    label: String(label || "marked region").trim() || "marked region",
    kind: region.kind === "text" || region.kind === "image" ? region.kind : "manual",
    nx: unit01(region.x / width),
    ny: unit01(region.y / height),
    nw: unit01(region.w / width),
    nh: unit01(region.h / height),
  };
}

export function kithChatFlyLandId(surfaceId?: string | null): string | null {
  const id = String(surfaceId ?? getActiveCanvasChatSurface() ?? "").trim();
  return id ? `${KITH_CHAT_FLY_LAND_PREFIX}${id}` : null;
}

/** Left Kith Composer landing point. Recombyn AgentDock lived on the right. */
export function resolveKithChatFlyTarget(): { x: number; y: number } {
  const doc = globalThis.document;
  const landId = kithChatFlyLandId();
  const scoped = landId
    ? doc?.querySelector(`[data-fly-land="${cssAttr(landId)}"]`) as HTMLElement | null
    : null;
  const anyComposer = doc?.querySelector('[data-fly-land^="kith-chat:"]') as HTMLElement | null;
  const el = scoped ?? anyComposer;
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 8 && r.height > 8) {
      return { x: r.left + Math.min(72, r.width * 0.28), y: r.top + r.height * 0.45 };
    }
  }
  const width = globalThis.window?.innerWidth ?? 1200;
  const height = globalThis.window?.innerHeight ?? 800;
  return {
    x: Math.min(180, Math.max(48, width * 0.16)),
    y: Math.max(120, height * 0.72),
  };
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(String(dataUrl || "").trim());
  if (!match) throw new Error("invalid data URL");
  const mime = match[1]?.trim() || "image/png";
  const binary = atob(match[2] || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

function safePngName(label: string): string {
  const stem = String(label || "marked-region").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${stem || "marked-region"}.png`;
}

export function requestComposerAttachFile(detail: ComposerAttachFileDetail): void {
  window.dispatchEvent(new CustomEvent(KITH_COMPOSER_ATTACH_FILE_EVENT, { detail }));
}

/**
 * Recombyn Mark cropped a region, flew it into the right AgentDock, and
 * queued an @ chip (`enqueueAgentContexts`). Kith has no AgentDock: land on
 * the left Composer, attach the crop, and freeze the boxed region onto the
 * Canvas selection snapshot. The region is Agent-only context — never composer
 * body or the visible chat message.
 */
export function sendMarkedImageRegionToChat(input: MarkedImageRegionToChatInput): void {
  const canvasId = input.canvasId.trim();
  const nodeId = input.nodeId.trim();
  const markedRegion = canvasMarkedRegionFromBox(
    nodeId,
    input.label,
    input.region,
    input.nodeWidth,
    input.nodeHeight,
  );
  if (canvasId && nodeId) {
    requestCanvasSelectionToChat(nodeId, { canvasId, markedRegions: [markedRegion] });
  }
  let file: File | undefined;
  if (input.dataUrl) {
    try {
      file = dataUrlToFile(input.dataUrl, safePngName(input.label));
    } catch {
      file = undefined;
    }
  }
  requestComposerAttachFile({
    file,
    surfaceId: getActiveCanvasChatSurface(),
  });
}
