/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/outlineTextFont.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Text → vector path via fontkit (TrueType / CFF / WOFF / WOFF2 glyph outlines).
 * Prefer this over canvas raster tracing — glyphs stay complete and crisp.
 */

import { create as createFontkitFont } from 'fontkit';
import { loadFontCatalog, resolveFontFileUrl } from '@recombyn-native/components/rcb/scene/document/fontCatalog';
import {
  parseNodeText,
  parseNodeTextStyle,
  textVerticalOriginY,
  textVisualLines,
  toFabricFontFamily,
} from '@recombyn-native/components/rcb/scene/document/sceneText';
import type { OutlineResult } from '@recombyn-native/components/rcb/scene/paint/outlineToPath';

type FkCommand = { command: string; args: number[] };
type FkGlyph = {
  id?: number;
  codePoints?: number[];
  path?: { commands: FkCommand[] };
  advanceWidth?: number;
};
type FkFont = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout: (text: string) => {
    glyphs: FkGlyph[];
    positions: Array<{ xAdvance?: number; yAdvance?: number; xOffset?: number; yOffset?: number }>;
  };
};

const fontCache = new Map<string, Promise<FkFont | null>>();

function parseWeight(fontWeight: string | number | undefined): number {
  if (fontWeight === 'bold' || fontWeight === '700') return 700;
  if (fontWeight === 'normal' || fontWeight === '400') return 400;
  const n = Number(fontWeight);
  return Number.isFinite(n) ? n : 400;
}

/** True when layout substituted .notdef / empty outline for a character that should draw. */
function runHasMissingGlyphs(run: { glyphs: FkGlyph[] }): boolean {
  for (const glyph of run.glyphs) {
    const cps = glyph.codePoints || [];
    const needsInk = cps.some((cp) => {
      try {
        // Skip space / ZW* / BOM — empty path is fine for those.
        return /[^\s\u200b-\u200d\ufeff]/.test(String.fromCodePoint(cp));
      } catch {
        return false;
      }
    });
    if (!needsInk) continue;
    // id 0 is .notdef — common when a Latin face layouts CJK (identical tofu boxes).
    if (glyph.id === 0) return true;
    if (!glyph.path?.commands?.length) return true;
  }
  return false;
}

function asSingleFont(created: unknown): FkFont | null {
  if (!created || typeof created !== 'object') return null;
  const any = created as FkFont & { fonts?: FkFont[] };
  if (Array.isArray(any.fonts) && any.fonts.length) {
    const face = any.fonts.find((f) => f?.unitsPerEm) || any.fonts[0];
    return face?.unitsPerEm ? face : null;
  }
  return any.unitsPerEm ? any : null;
}

async function fetchFontkitFont(url: string): Promise<FkFont | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font fetch ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return asSingleFont(createFontkitFont(buf));
  } catch (err) {
    console.warn('[outlineTextFont] failed to load font', url, err);
    fontCache.delete(url);
    return null;
  }
}

async function loadFontkitFont(url: string): Promise<FkFont | null> {
  if (!url) return null;
  let pending = fontCache.get(url);
  if (!pending) {
    pending = fetchFontkitFont(url);
    fontCache.set(url, pending);
  }
  return pending;
}

function commandsToPathD(commands: FkCommand[], ox: number, oy: number, scale: number): string {
  if (!commands?.length) return '';
  const out: string[] = [];
  // 1 decimal (~0.1px) — halves outline payload vs toFixed(2) with no visible loss.
  const X = (x: number) => (ox + x * scale).toFixed(1);
  const Y = (y: number) => (oy - y * scale).toFixed(1); // font space ↑ → SVG ↓
  for (const c of commands) {
    const a = c.args || [];
    switch (c.command) {
      case 'moveTo':
        if (a.length >= 2) out.push(`M ${X(a[0])} ${Y(a[1])}`);
        break;
      case 'lineTo':
        if (a.length >= 2) out.push(`L ${X(a[0])} ${Y(a[1])}`);
        break;
      case 'quadraticCurveTo':
        if (a.length >= 4) {
          out.push(`Q ${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])}`);
        }
        break;
      case 'bezierCurveTo':
        if (a.length >= 6) {
          out.push(
            `C ${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])}`
          );
        }
        break;
      case 'closePath':
        out.push('Z');
        break;
      default:
        break;
    }
  }
  return out.join(' ');
}

function measureLayoutWidth(
  font: FkFont,
  line: string,
  scale: number,
  letterSpacing: number
): number {
  if (!line) return 0;
  const run = font.layout(line);
  let w = 0;
  const n = run.glyphs.length;
  for (let i = 0; i < n; i += 1) {
    const pos = run.positions[i];
    w += (pos?.xAdvance ?? run.glyphs[i]?.advanceWidth ?? 0) * scale;
    if (i < n - 1) w += letterSpacing;
  }
  return w;
}

/**
 * Build closed glyph paths for a text node using the catalog font file.
 * Returns null when the face has no downloadable url (caller may raster-fallback).
 */
export async function outlineTextFromFont(node: SceneNodeInput): Promise<OutlineResult | null> {
  if (typeof document === 'undefined' || !node) return null;
  const plain = parseNodeText(node.attrs || {}).trim();
  if (!plain) return null;

  await loadFontCatalog();

  const style = parseNodeTextStyle(node.attrs || {});
  const family = toFabricFontFamily(style.fontFamily);
  const weight = parseWeight(style.fontWeight);
  const url = resolveFontFileUrl(family, weight);
  if (!url) return null;

  const font = await loadFontkitFont(url);
  if (!font?.unitsPerEm) return null;

  const boxW = Math.max(1, Number(node.width) || 1);
  const boxH = Math.max(1, Number(node.height) || 1);
  const fontSize = Math.max(1, Number(style.fontSize) || 14);
  const scale = fontSize / font.unitsPerEm;
  const lineHeight = Math.max(0.8, Number(style.lineHeight) || 1.4);
  const letterSpacing = Number(style.letterSpacing) || 0;
  const align = String(style.textAlign || 'left');
  const autoSize = String(node.attrs?.autoSize ?? 'true') !== 'false';
  // Match sceneToSvg: fixed-width boxes soft-wrap; hug text uses hard \n only.
  const lines = textVisualLines(plain, style, { width: boxW, autoSize });
  const ascentPx = font.ascent * scale;
  const parts: string[] = [];
  const originY = !autoSize
    ? textVerticalOriginY(boxH, fontSize, lineHeight, Math.max(1, lines.length))
    : 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    const raw = line.length ? line : ' ';
    const lineW = measureLayoutWidth(font, raw, scale, letterSpacing);
    let penX = 0;
    if (align === 'center') penX = (boxW - lineW) / 2;
    else if (align === 'right') penX = boxW - lineW;

    // Match SVG text: dominant-baseline text-before-edge at y = lineTop.
    const lineTop = originY + lineIdx * fontSize * lineHeight;
    const baseline = lineTop + ascentPx;

    const run = font.layout(raw);
    // Latin-only face + CJK text → identical .notdef boxes. Bail to canvas.
    if (runHasMissingGlyphs(run)) {
      console.warn(
        '[outlineTextFont] missing glyphs for face',
        family,
        '— falling back to canvas outline'
      );
      return null;
    }
    for (let i = 0; i < run.glyphs.length; i += 1) {
      const glyph = run.glyphs[i];
      const pos = run.positions[i] || {};
      const gx = penX + (pos.xOffset || 0) * scale;
      const gy = baseline - (pos.yOffset || 0) * scale;
      const d = commandsToPathD(glyph.path?.commands || [], gx, gy, scale);
      if (d.trim()) parts.push(d);
      penX += (pos.xAdvance ?? glyph.advanceWidth ?? 0) * scale;
      if (i < run.glyphs.length - 1) penX += letterSpacing;
    }
  }

  if (!parts.length) return null;

  return {
    pathD: parts.join(' '),
    closed: true,
    fillColor: String(style.fill || '#333333'),
    // TrueType / CFF glyph contours use nonzero winding (not evenodd).
    fillRule: 'nonzero',
  };
}

/** Warm catalog + resolve url (for UI / diagnostics). */
export async function canOutlineTextFromFont(node: SceneNodeInput): Promise<boolean> {
  if (!node || node.key !== 'text') return false;
  await loadFontCatalog();
  const style = parseNodeTextStyle(node.attrs || {});
  const family = toFabricFontFamily(style.fontFamily);
  return Boolean(resolveFontFileUrl(family, parseWeight(style.fontWeight)));
}
