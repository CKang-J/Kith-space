/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/systemPaste.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  fitImageSize,
  parseLottieAnimationData
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';

export type SystemPastePayload =
  | { kind: 'image'; file: File }
  | { kind: 'video'; file: File }
  | { kind: 'audio'; file: File }
  | { kind: 'lottie'; animationData: Record<string, unknown>; name?: string }
  | { kind: 'svg'; markup: string }
  | { kind: 'text'; text: string };

export function looksLikeSvgMarkup(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^data:image\/svg\+xml/i.test(t)) return true;
  if (/^<\?xml[\s\S]*?<svg[\s>]/i.test(t)) return true;
  return /^<svg[\s>]/i.test(t);
}

export function decodeClipboardSvgText(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^data:image\/svg\+xml/i.test(t)) {
    const comma = t.indexOf(',');
    const payload = comma >= 0 ? t.slice(comma + 1) : '';
    const header = comma >= 0 ? t.slice(0, comma) : '';
    try {
      return header.toLowerCase().includes(';base64')
        ? decodeURIComponent(escape(atob(payload)))
        : decodeURIComponent(payload.replace(/\+/g, ' '));
    } catch {
      return '';
    }
  }
  return t;
}

/** Size SVG icon from viewBox / width / height attrs (default 48, mid-cap 280). */
export function measureSvgMarkupSize(markup: string): { width: number; height: number; svg: string } {
  const trimmed = String(markup || '').trim();
  const svg = /^<svg[\s>]/i.test(trimmed)
    ? trimmed
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${trimmed}</svg>`;
  let vbW = 24;
  let vbH = 24;
  try {
    const doc = new DOMParser().parseFromString(
      /^<svg[\s>]/i.test(svg)
        ? svg
        : `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
      'image/svg+xml'
    );
    const root = doc.querySelector('svg');
    if (root && !doc.querySelector('parsererror')) {
      const vb = String(root.getAttribute('viewBox') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        vbW = vb[2];
        vbH = vb[3];
      } else {
        const wAttr = Number.parseFloat(String(root.getAttribute('width') || ''));
        const hAttr = Number.parseFloat(String(root.getAttribute('height') || ''));
        if (wAttr > 0 && hAttr > 0) {
          vbW = wAttr;
          vbH = hAttr;
        }
      }
    }
  } catch {
    /* keep defaults */
  }
  const fitted = fitImageSize(vbW, vbH, 280);
  return {
    width: Math.max(16, fitted.width),
    height: Math.max(16, fitted.height),
    svg,
  };
}

export function fileLooksLikeSvg(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.includes('svg')) return true;
  return /\.svg$/i.test(file.name || '');
}

export function fileLooksLikeLottie(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (/\.json$/i.test(name)) return true;
  return mime === 'application/json' || mime === 'text/json';
}

function lottieNameFromFile(file: File): string {
  return String(file.name || '')
    .replace(/\.json$/i, '')
    .trim() || 'Lottie';
}

async function tryReadLottieFile(file: File): Promise<SystemPastePayload | null> {
  if (!fileLooksLikeLottie(file)) return null;
  try {
    const text = await file.text();
    const animationData = parseLottieAnimationData(text);
    if (!animationData) return null;
    return { kind: 'lottie', animationData, name: lottieNameFromFile(file) };
  } catch {
    return null;
  }
}

function tryParseLottieText(plain: string): SystemPastePayload | null {
  const animationData = parseLottieAnimationData(plain);
  if (!animationData) return null;
  return { kind: 'lottie', animationData, name: 'Lottie' };
}

/** Prefer image/video/audio → Lottie JSON → SVG markup → plain text. */
export async function readSystemPastePayload(
  data: DataTransfer | null | undefined
): Promise<SystemPastePayload | null> {
  if (!data) return null;

  const fromItems: File[] = [];
  try {
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f) fromItems.push(f);
    }
  } catch {
    /* ignore */
  }
  const files = fromItems.length ? fromItems : Array.from(data.files || []);
  for (const file of files) {
    if (fileLooksLikeSvg(file)) {
      try {
        const markup = decodeClipboardSvgText(await file.text());
        if (looksLikeSvgMarkup(markup)) return { kind: 'svg', markup };
      } catch {
        /* fall through */
      }
    }
    const lottie = await tryReadLottieFile(file);
    if (lottie) return lottie;
    const mime = (file.type || '').toLowerCase();
    if (mime.startsWith('image/')) {
      return { kind: 'image', file };
    }
    if (mime.startsWith('video/')) {
      return { kind: 'video', file };
    }
    if (mime.startsWith('audio/')) {
      return { kind: 'audio', file };
    }
    // Extension fallback when OS omits mime (common for .mp3 / .m4a).
    if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '')) {
      return { kind: 'audio', file };
    }
  }

  const plain = String(data.getData('text/plain') || '').trim();
  if (plain) {
    const markup = decodeClipboardSvgText(plain);
    if (looksLikeSvgMarkup(markup)) return { kind: 'svg', markup };
    const lottie = tryParseLottieText(plain);
    if (lottie) return lottie;
    return { kind: 'text', text: plain };
  }

  const html = String(data.getData('text/html') || '');
  if (html) {
    const m = html.match(/<svg[\s\S]*?<\/svg>/i);
    if (m?.[0] && looksLikeSvgMarkup(m[0])) {
      return { kind: 'svg', markup: m[0] };
    }
  }

  return null;
}

export function fingerprintSystemPaste(payload: SystemPastePayload | null | undefined): string {
  if (!payload) return '';
  if (payload.kind === 'image' || payload.kind === 'video' || payload.kind === 'audio') {
    const f = payload.file;
    return `${payload.kind}:${f.type}:${f.size}:${f.name}:${f.lastModified}`;
  }
  if (payload.kind === 'lottie') {
    const raw = JSON.stringify(payload.animationData);
    return `lottie:${raw.length}:${raw.slice(0, 96)}:${raw.slice(-48)}`;
  }
  if (payload.kind === 'svg') {
    const m = payload.markup;
    return `svg:${m.length}:${m.slice(0, 96)}:${m.slice(-48)}`;
  }
  const t = payload.text;
  return `text:${t.length}:${t.slice(0, 96)}:${t.slice(-48)}`;
}

export async function readSystemPasteFromNavigator(): Promise<SystemPastePayload | null> {
  const clip = navigator.clipboard;
  if (!clip) return null;

  if (typeof clip.read === 'function') {
    try {
      const items = await clip.read();
      for (const item of items) {
        const types = item.types || [];
        const svgType = types.find((t) => t.includes('svg'));
        if (svgType) {
          const blob = await item.getType(svgType);
          const markup = decodeClipboardSvgText(await blob.text());
          if (looksLikeSvgMarkup(markup)) return { kind: 'svg', markup };
        }
        const imageType = types.find((t) => t.startsWith('image/') && !t.includes('svg'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.includes('jpeg') || imageType.includes('jpg') ? 'jpg' : 'png';
          return {
            kind: 'image',
            file: new File([blob], `paste.${ext}`, { type: imageType }),
          };
        }
        const videoType = types.find((t) => t.startsWith('video/'));
        if (videoType) {
          const blob = await item.getType(videoType);
          let ext = 'mp4';
          if (videoType.includes('webm')) ext = 'webm';
          else if (videoType.includes('quicktime')) ext = 'mov';
          return {
            kind: 'video',
            file: new File([blob], `paste.${ext}`, { type: videoType }),
          };
        }
        const audioType = types.find((t) => t.startsWith('audio/'));
        if (audioType) {
          const blob = await item.getType(audioType);
          let ext = 'mp3';
          if (audioType.includes('wav')) ext = 'wav';
          else if (audioType.includes('ogg')) ext = 'ogg';
          else if (audioType.includes('mp4') || audioType.includes('m4a')) ext = 'm4a';
          return {
            kind: 'audio',
            file: new File([blob], `paste.${ext}`, { type: audioType }),
          };
        }
        if (types.includes('application/json') || types.includes('text/json')) {
          const type = types.includes('application/json')
            ? 'application/json'
            : 'text/json';
          const blob = await item.getType(type);
          const text = String(await blob.text()).trim();
          const lottie = tryParseLottieText(text);
          if (lottie) return lottie;
        }
        if (types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const plain = String(await blob.text()).trim();
          if (!plain) continue;
          const markup = decodeClipboardSvgText(plain);
          if (looksLikeSvgMarkup(markup)) return { kind: 'svg', markup };
          const lottie = tryParseLottieText(plain);
          if (lottie) return lottie;
          return { kind: 'text', text: plain };
        }
      }
    } catch {
      /* permission / unsupported — try readText */
    }
  }

  if (typeof clip.readText === 'function') {
    try {
      const plain = String(await clip.readText()).trim();
      if (!plain) return null;
      const markup = decodeClipboardSvgText(plain);
      if (looksLikeSvgMarkup(markup)) return { kind: 'svg', markup };
      const lottie = tryParseLottieText(plain);
      if (lottie) return lottie;
      return { kind: 'text', text: plain };
    } catch {
      return null;
    }
  }
  return null;
}
