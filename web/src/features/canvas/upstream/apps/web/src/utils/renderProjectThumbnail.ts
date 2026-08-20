/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/renderProjectThumbnail.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Rasterize project covers for list cards / Publish / cloud sync.
 * Up to 4 tiles: per-artboard or per-element snapshots — never raw node src.
 */

import { inlineSvgImages, rasterizeSvgString, renderExport } from '@recombyn-native/components/rcb/scene/paint/exportImage';
import { createSvgBoard, loadSceneOntoSvg } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  isExportableSceneNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  listSceneNodes
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import {
  coverDocumentHasContent,
  extractFrameDocument,
  extractPlazaCoverDocument,
  findPlazaCoverFrame,
  listArtboardFrames,
  type PlazaCoverFrame,
} from '@recombyn-native/utils/plazaCover';

const MAX_EDGE = 480;
const MAX_TILES = 4;
const TILE_MAX_EDGE = 360;
const WEBP_QUALITY = 0.82;
/** Skip decorative noise smaller than ~1% of the artboard (or 40px edge). */
const MIN_ELEMENT_EDGE = 40;
/** Case preview modal — keep panels sharp (not list-card WebP). */
export const PREVIEW_PNG_MAX_EDGE = 1600;

export type ThumbRasterOptions = {
  allowEmpty?: boolean;
  /** Prefer png for HD previews; webp/jpeg for compact list thumbs. */
  format?: 'webp' | 'png' | 'jpeg';
  maxEdge?: number;
};

function paperBackground(document: SceneDocument): string {
  const frame = Array.isArray(document?.frames) ? document.frames[0] : null;
  const fromFrame = String(frame?.backgroundColor || '').trim();
  if (fromFrame && fromFrame !== 'none' && fromFrame !== 'transparent') return fromFrame;
  const fromDoc = String(document?.backgroundColor || '').trim();
  if (fromDoc && fromDoc !== 'none' && fromDoc !== 'transparent') return fromDoc;
  return '#ffffff';
}

/** Build a full-board WebP for project list / publish preview (contain, not cropped). */
export async function renderProjectThumbnail(document: unknown): Promise<string | null> {
  if (!document || typeof document !== 'object') return null;
  const cover = extractPlazaCoverDocument(document, { contentFit: true }) || document;
  return renderDocumentThumbnail(cover, { allowEmpty: true });
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Same overlap rule as plaza cover extract — node must sit mostly on the artboard. */
function nodeOverlapsFrame(node: Record<string, unknown>, frame: PlazaCoverFrame): boolean {
  const x = num(node.x);
  const y = num(node.y);
  const w = Math.max(1, num(node.width, 1));
  const h = Math.max(1, num(node.height, 1));
  const ow = Math.max(0, Math.min(x + w, frame.x + frame.width) - Math.max(x, frame.x));
  const oh = Math.max(0, Math.min(y + h, frame.y + frame.height) - Math.max(y, frame.y));
  return ow * oh >= w * h * 0.12;
}

/** Media → shape/svg → text → other (collage prefers visual tiles). */
function coverElementTypeRank(key: string): number {
  if (key === 'image' || key === 'video') return 0;
  if (key === 'lottie' || key === 'audio') return 1;
  if (
    key === 'svg' ||
    key === 'path' ||
    key === 'shape' ||
    key === 'rect' ||
    key === 'ellipse' ||
    key === 'circle' ||
    key === 'line'
  ) {
    return 2;
  }
  if (key === 'text') return 3;
  return 4;
}

/** Skip empty media plates (#E5E7EB placeholders) — they steal collage slots from real shapes. */
function coverElementHasVisual(node: Record<string, unknown>): boolean {
  const key = String(node.key || '');
  const attrs =
    node.attrs && typeof node.attrs === 'object'
      ? (node.attrs as Record<string, unknown>)
      : {};
  if (key === 'image' || key === 'video' || key === 'lottie') {
    const src = String(attrs.src || '').trim();
    const poster = String(attrs.poster || '').trim();
    return Boolean(src || poster);
  }
  if (key === 'audio') return Boolean(String(attrs.src || '').trim());
  return true;
}

/**
 * Pick up to 4 exportable scene elements for the home collage.
 * Scope: active/cover artboard when present; rank image-first, then area, then z-order.
 */
export function pickCoverElementIds(document: unknown): string[] {
  if (!document || typeof document !== 'object') return [];
  const frame = findPlazaCoverFrame(document);
  const frameArea = frame ? frame.width * frame.height : 0;
  const minArea = frameArea > 0 ? frameArea * 0.01 : MIN_ELEMENT_EDGE * MIN_ELEMENT_EDGE;

  type Ranked = { id: string; typeRank: number; area: number; z: number };
  const ranked: Ranked[] = [];
  const nodes = listSceneNodes(document as SceneDocument) as Array<{
    id: string;
    node: Record<string, unknown>;
  }>;

  nodes.forEach(({ id, node }, z) => {
    if (!id || !node || typeof node !== 'object') return;
    if (!isExportableSceneNode(node)) return;
    if (!coverElementHasVisual(node)) return;
    if (frame && !nodeOverlapsFrame(node, frame)) return;
    const w = Math.max(1, num(node.width, 1));
    const h = Math.max(1, num(node.height, 1));
    const area = w * h;
    if (area < minArea && Math.min(w, h) < MIN_ELEMENT_EDGE) return;
    ranked.push({
      id: String(id),
      typeRank: coverElementTypeRank(String(node.key || '')),
      area,
      z,
    });
  });

  ranked.sort((a, b) => {
    if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
    if (b.area !== a.area) return b.area - a.area;
    return b.z - a.z;
  });

  return ranked.slice(0, MAX_TILES).map((r) => r.id);
}

/**
 * Mini document with one element on a white board — same finite-board path as list thumbs.
 * Avoids infinite-canvas selection export (shapes often rasterized to empty/gray tiles).
 */
function extractElementCoverDocument(document: unknown, nodeId: string): unknown | null {
  const dsl = (document as { deltaSetLike?: Record<string, unknown> })?.deltaSetLike;
  const raw = dsl?.[nodeId];
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;
  if (!isExportableSceneNode(node) || !coverElementHasVisual(node)) return null;

  const w = Math.max(1, num(node.width, 1));
  const h = Math.max(1, num(node.height, 1));
  const pad = Math.max(12, Math.round(Math.max(w, h) * 0.08));
  const boardW = Math.max(32, Math.round(w + pad * 2));
  const boardH = Math.max(32, Math.round(h + pad * 2));
  const id = String(nodeId);

  return {
    width: boardW,
    height: boardH,
    backgroundColor: '#ffffff',
    backgroundFillType: 'solid',
    frames: [
      {
        id: 'element-cover',
        x: 0,
        y: 0,
        width: boardW,
        height: boardH,
        backgroundColor: '#ffffff',
      },
    ],
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'entry', children: [id] },
      [id]: {
        ...node,
        id,
        x: pad,
        y: pad,
        width: w,
        height: h,
      },
    },
  };
}

/** Rasterize one element (cropped to its bbox) for a collage tile. */
async function rasterizeElementTile(
  document: unknown,
  nodeId: string,
  opts?: { maxEdge?: number; format?: 'webp' | 'png' | 'jpeg'; compress?: boolean }
): Promise<string | null> {
  const slice = extractElementCoverDocument(document, nodeId);
  if (!slice) return null;

  const maxEdge = Math.max(64, Math.round(opts?.maxEdge || TILE_MAX_EDGE));
  let format: 'webp' | 'png' | 'jpeg' = 'webp';
  if (opts?.format === 'png' || opts?.format === 'jpeg') format = opts.format;

  try {
    const viaThumb = await renderDocumentThumbnail(slice, {
      allowEmpty: true,
      format,
      maxEdge,
    });
    if (viaThumb) return viaThumb;
  } catch {
    /* fall through to export */
  }

  // Fallback: selection export (images with remote src sometimes need inline pass).
  try {
    const exportFormat = format === 'webp' ? 'png' : format;
    const result = await renderExport({
      document: slice as SceneDocument,
      selectionOnly: true,
      nodeIds: [nodeId],
      multiplier: 1,
      format: exportFormat,
      compress: opts?.compress ?? exportFormat === 'jpeg',
      backgroundColor: '#ffffff',
    });
    if (result?.kind === 'raster' && result.dataUrl) return result.dataUrl;
  } catch {
    /* best-effort per tile */
  }
  return null;
}

export type ProjectCoverTiles = {
  /** Already-hosted image URLs — rare passthrough. */
  urls?: string[];
  /** Raster data URLs to upload as project thumbs. */
  dataUrls?: string[];
};

export type ProjectCoverTileOptions = {
  /** Longest edge for each tile (default list-card 360). Publish modal should pass ~960+. */
  maxEdge?: number;
  format?: 'webp' | 'png' | 'jpeg';
  /** JPEG only — list cards compress; HD previews should pass false. */
  compress?: boolean;
  /** Full-board fallback max edge (default 480 list / use PREVIEW_PNG_MAX_EDGE for modal). */
  fullBoardMaxEdge?: number;
};

/** List thumbs use webp; jpeg callers map to webp. PNG kept for HD publish preview. */
function resolveCoverTileRasterOpts(opts?: ProjectCoverTileOptions) {
  let format: 'webp' | 'png' = 'webp';
  if (opts?.format === 'png') format = 'png';

  const tileMax = opts?.maxEdge ?? TILE_MAX_EDGE;

  let fullMax = MAX_EDGE;
  if (opts?.fullBoardMaxEdge != null) fullMax = opts.fullBoardMaxEdge;
  else if (opts?.maxEdge != null) fullMax = opts.maxEdge;

  return { format, tileMax, fullMax };
}

/**
 * Up to 4 cover tiles for list collage / Publish / cloud sync.
 * 2+ artboards → one snapshot each; else up to 4 per-element rasters; else full board.
 */
export async function buildProjectCoverTiles(
  document: unknown,
  opts?: ProjectCoverTileOptions
): Promise<ProjectCoverTiles> {
  if (!document || typeof document !== 'object') return {};

  const { format: thumbFormat, tileMax } = resolveCoverTileRasterOpts(opts);
  const frames = listArtboardFrames(document).slice(0, MAX_TILES);

  if (frames.length >= 2) {
    const slices = frames
      .map((frame) => extractFrameDocument(document, frame, { contentFit: true }))
      .filter(Boolean);
    const rendered = await Promise.all(
      slices.map((slice) =>
        renderDocumentThumbnail(slice, {
          allowEmpty: true,
          format: thumbFormat,
          maxEdge: tileMax,
        })
      )
    );
    const dataUrls = rendered.filter((u): u is string => Boolean(u));
    if (dataUrls.length) return { dataUrls };
  }

  // Single board: up to 4 element tiles (square / image / circle each as one cover).
  const ids = pickCoverElementIds(document);
  if (ids.length) {
    const rendered = await Promise.all(
      ids.map((id) =>
        rasterizeElementTile(document, id, {
          maxEdge: opts?.maxEdge ?? tileMax,
          format: opts?.format ?? thumbFormat,
          compress: opts?.compress,
        })
      )
    );
    const dataUrls = rendered.filter((u): u is string => Boolean(u));
    if (dataUrls.length) return { dataUrls };
  }

  return buildProjectCoverSingle(document, opts);
}

/** Fallback: one full-board cover when collage tiles are unavailable. */
export async function buildProjectCoverSingle(
  document: unknown,
  opts?: ProjectCoverTileOptions
): Promise<ProjectCoverTiles> {
  if (!document || typeof document !== 'object') return {};
  const { format: thumbFormat, fullMax } = resolveCoverTileRasterOpts(opts);
  const one = await renderDocumentThumbnail(
    extractPlazaCoverDocument(document, { contentFit: true }) || document,
    {
      allowEmpty: true,
      format: thumbFormat,
      maxEdge: fullMax,
    }
  );
  return one ? { dataUrls: [one] } : {};
}

/**
 * Rasterize an already-extracted cover / artboard document to a data URL.
 * Used by list cards so the DOM shows `<img>`, not live SVG.
 */
export async function renderDocumentThumbnail(
  document: unknown,
  opts?: ThumbRasterOptions
): Promise<string | null> {
  if (!document || typeof document !== 'object') return null;
  if (!opts?.allowEmpty && !coverDocumentHasContent(document)) return null;

  const format = opts?.format || 'webp';
  const maxEdge = Math.max(64, Math.round(opts?.maxEdge || MAX_EDGE));

  const doc = document as {
    width?: number;
    height?: number;
    frames?: Array<{ width?: number; height?: number }>;
  };
  const frame = Array.isArray(doc.frames) ? doc.frames[0] : null;
  const docW = Math.max(1, Math.round(Number(frame?.width || doc.width) || 794));
  const docH = Math.max(1, Math.round(Number(frame?.height || doc.height) || 1123));
  const scale = Math.min(1, maxEdge / Math.max(docW, docH));
  const outW = Math.max(32, Math.round(docW * scale));
  const outH = Math.max(32, Math.round(docH * scale));
  const bg = paperBackground(document as SceneDocument);

  const host = window.document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
  window.document.body.appendChild(host);

  try {
    const previewDoc = {
      ...(document as object),
      width: docW,
      height: docH,
      backgroundColor: bg,
      backgroundFillType: 'solid',
    } as unknown as SceneDocument;
    const { root, layer } = createSvgBoard(host, docW, docH);
    await loadSceneOntoSvg(root, layer, previewDoc, 0, undefined, {
      omitNonExportable: true,
    });

    const xml = new XMLSerializer().serializeToString(root);
    const inlined = await inlineSvgImages(xml, previewDoc, { failClosed: false });
    const mime =
      format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const quality = format === 'png' ? undefined : WEBP_QUALITY;
    return await rasterizeSvgString(inlined, outW, outH, mime, quality, false, bg);
  } catch {
    return null;
  } finally {
    host.remove();
  }
}
