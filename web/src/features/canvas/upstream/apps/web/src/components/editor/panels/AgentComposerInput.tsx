/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/AgentComposerInput.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, memo } from 'react';
import { cn } from '@recombyn-native/utils/classnames';
import { parseNodeText } from '@recombyn-native/components/rcb/scene/document/sceneText';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  frameIdContainingNode,
  buildSceneNodesForEdit,
  buildSceneNodesForIds,
} from '@/features/canvas/adapters/recombynComposerSceneContext';
import { renderComposerChipThumb, renderExport } from '@recombyn-native/components/rcb/scene/paint/exportImage';
import { imageSrcToFile } from '@/features/canvas/adapters/recombynLocalMedia';
import { sanitizeSvg } from '@recombyn-native/utils/sanitizeHtml';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';


function editorHasComposerChips(el: HTMLElement | null | undefined): boolean {
  return Boolean(el?.querySelector('[data-composer-chip="1"]'));
}

/** Shared pill classes — composer DOM chips + chat history bubbles. */
export const CONTEXT_CHIP_PILL_CLASS =
  'inline-flex h-6 max-w-full shrink-0 items-center gap-1 align-middle rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[12px] leading-none text-[var(--ink)]';

const CONTEXT_CHIP_THUMB_CLASS =
  'h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--line)]';

const CONTEXT_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>';

function isSkillComposerContext(ctx: { kind?: string; key?: string }): boolean {
  return ctx.kind === 'skill' || Boolean(ctx.key?.startsWith('skill:'));
}

function contextChipPaddingClass(opts: {
  thumbUrl?: string | null;
  onRemove?: (() => void) | null;
}): string {
  if (opts.thumbUrl) return 'pl-1 pr-0.5';
  if (opts.onRemove) return 'pl-1.5 pr-0.5';
  return 'px-1.5';
}

/** Read-only / history chip matching the composer pill (optional × when `onRemove`). */
function ContextChipPill({
  label,
  thumbUrl,
  hideLeadingIcon,
  onRemove,
  className,
}: {
  label: string;
  thumbUrl?: string;
  /** Skill chips: label (+ ×) only — no nested-squares placeholder. */
  hideLeadingIcon?: boolean;
  onRemove?: () => void;
  className?: string;
}): ReactNode {
  const showIcon = !thumbUrl && !hideLeadingIcon;
  return (
    <span
      className={cn(
        CONTEXT_CHIP_PILL_CLASS,
        contextChipPaddingClass({ thumbUrl, onRemove }),
        className
      )}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="" className={CONTEXT_CHIP_THUMB_CLASS} />
      ) : null}
      {!thumbUrl && showIcon ? (
        <span
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[var(--canvas)] text-[var(--muted)] ring-1 ring-[var(--line)]"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(CONTEXT_ICON_SVG) }}
        />
      ) : null}
      <span className="truncate font-medium">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove context"
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)]"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Selection / frame / pinned element reference chip. */
export type ComposerContext = {
  /** Unique key for dismiss tracking, e.g. frame:id or node:id */
  key: string;
  label: string;
  /** frame | text | image | shape | multi | group | attachment */
  kind: string;
  /** Payload sent with the chat message (keep small — no huge data URLs). */
  payload: string;
  /** Image ref for vision / create_image (https upload URL or data URL). */
  dataUrl?: string;
  /** Chip thumbnail (image node `src` or local data-URL preview). */
  thumbUrl?: string;
  /** Legacy attachment identity retained for native chip compatibility; Stage 1 never uploads. */
  uploadKey?: string;
  /**
   * Composer attachment upload lifecycle.
   * `uploading` → local preview shown with spinner; omit / `ready` once server upload finishes.
   */
  uploadStatus?: 'uploading' | 'ready' | 'error';
};

export type AgentComposerHandle = {
  focus: () => void;
  /** Focus and unconditionally move caret to the end of the editable. */
  focusEnd: () => void;
  /** Insert a context chip at the caret (or last known caret / end). */
  insertContextAtCaret: (ctx: ComposerContext) => void;
  /** Plain text with U+FFFC where each context chip sits (DOM order). */
  getMarkedText: () => string;
  /**
   * Screen rect of the active `@…` mention (last @ with no whitespace after).
   * Used to anchor the attach picker to the caret, not the whole composer.
   */
  getAtMentionAnchorRect: () => DOMRect | null;
  /** Screen rect of the active `/…` skill mention. */
  getSlashMentionAnchorRect: () => DOMRect | null;
};

function placeCaretAtEnd(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function readPlainText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.composerChip === '1') return;
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
}

/** Same as plain text but inserts U+FFFC for each context chip (inline positions). */
function readMarkedText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.composerChip === '1') {
      out += '\uFFFC';
      return;
    }
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
}

/** Update plain text without rebuilding chips (keeps chip nodes in the DOM). */
function syncPlainText(root: HTMLElement, text: string) {
  const hasChip = Boolean(root.querySelector('[data-composer-chip="1"]'));
  // Interleaved mid-text chips: collapsing all text into one trailing node jumps
  // chips to the front. Only clear/replace when empty or there are no chips.
  if (hasChip && text !== '') {
    const current = readPlainText(root);
    if (current === text) return;
    // Typing / caret inserts already mutate the DOM via handleInput / insertContextAtCaret.
    return;
  }

  const sel = window.getSelection();
  const restore =
    sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)
      ? getPlainTextCaretOffset(root)
      : null;

  // Empty contenteditable often keeps a lone <br> for the caret. readPlainText
  // ignores it, so a text-only replace used to leave `<br>prompt` → blank line
  // above (home example chips / programmatic setValue).
  if (!hasChip) {
    root.replaceChildren(document.createTextNode(text || ''));
  } else {
    const textNodes: ChildNode[] = [];
    const collect = (parent: Node) => {
      for (const n of Array.from(parent.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) {
          textNodes.push(n);
          continue;
        }
        if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).dataset?.composerChip === '1') {
          continue;
        }
        collect(n);
      }
    };
    collect(root);
    textNodes.forEach((n) => n.parentNode?.removeChild(n));
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
        node.parentNode?.removeChild(node);
      }
    }
    root.appendChild(document.createTextNode(text || '\u200b'));
  }

  if (restore != null && document.activeElement === root) {
    const range = setPlainTextCaretOffset(root, restore);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/** Plain-text caret offset ignoring chips (for restore after blur). */
function getPlainTextCaretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const rangeBefore = document.createRange();
  rangeBefore.setStart(root, 0);
  rangeBefore.setEnd(range.startContainer, range.startOffset);
  const frag = rangeBefore.cloneContents();
  let offset = 0;
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      offset += (n.textContent || '').replace(/\u200b/g, '').length;
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).dataset?.composerChip === '1') {
      return;
    }
    n.childNodes.forEach(walk);
  };
  frag.childNodes.forEach(walk);
  return offset;
}

function setPlainTextCaretOffset(root: HTMLElement, target: number): Range {
  const range = document.createRange();
  let remaining = Math.max(0, target);
  let found = false;

  const walk = (node: Node): boolean => {
    if (found) return true;
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || '';
      const plain = raw.replace(/\u200b/g, '');
      // Map plain offset into raw text (account for zwsp roughly by using raw length when equal)
      if (remaining <= plain.length) {
        // Prefer placing in this text node
        let rawIdx = 0;
        let plainIdx = 0;
        while (rawIdx < raw.length && plainIdx < remaining) {
          if (raw[rawIdx] !== '\u200b') plainIdx += 1;
          rawIdx += 1;
        }
        range.setStart(node, rawIdx);
        range.collapse(true);
        found = true;
        return true;
      }
      remaining -= plain.length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset.composerChip === '1') return false;
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }
    return false;
  };

  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) break;
  }
  if (!found) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  return range;
}

/** Client rect for an active `@` / `/` trigger token (follows caret). */
function getTriggerAnchorRect(root: HTMLElement, trigger: '@' | '/'): DOMRect | null {
  const text = readPlainText(root);
  let at = -1;
  if (trigger === '@') {
    at = text.lastIndexOf('@');
    if (at < 0) return null;
    if (/\s/.test(text.slice(at + 1))) return null;
  } else {
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] !== '/') continue;
      if (/\s/.test(text.slice(i + 1))) return null;
      if (i > 0 && !/\s/.test(text[i - 1]!)) continue;
      at = i;
      break;
    }
    if (at < 0) return null;
  }
  try {
    const start = setPlainTextCaretOffset(root, at);
    const end = setPlainTextCaretOffset(root, Math.min(text.length, at + 1));
    const range = document.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.startContainer, end.startOffset);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return new DOMRect(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 16));
    }
    const caret = start.getBoundingClientRect();
    if (caret.left || caret.top) {
      return new DOMRect(caret.left, caret.top, 1, Math.max(caret.height, 16));
    }
  } catch {
    /* fall through */
  }
  const box = root.getBoundingClientRect();
  return new DOMRect(box.left + 8, box.top + 4, 1, 18);
}

function getAtMentionAnchorRect(root: HTMLElement): DOMRect | null {
  return getTriggerAnchorRect(root, '@');
}

const CHIP_STYLE = '3';
/** Separates stable ref id from per-insert instance id (`node:abc@@x7k`). */
export const CHIP_INSTANCE_SEP = '@@';

/** Stable identity without instance suffix (for payload / send parsing). */
export function chipBaseKey(key: string): string {
  const i = key.lastIndexOf(CHIP_INSTANCE_SEP);
  return i >= 0 ? key.slice(0, i) : key;
}

/** Infer media kind from an attachment chip (payload / data URL / extension). */
export function composerAttachmentMediaKind(
  c: Pick<ComposerContext, 'dataUrl' | 'thumbUrl' | 'payload'>
): 'image' | 'video' | 'audio' {
  const data = String(c.dataUrl || '');
  const payload = String(c.payload || '');
  const blob = `${data} ${c.thumbUrl || ''} ${payload}`;
  if (
    data.startsWith('data:audio/') ||
    /\[Attached audio\]/i.test(payload) ||
    /\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i.test(blob)
  ) {
    return 'audio';
  }
  if (
    data.startsWith('data:video/') ||
    /\[Attached video\]/i.test(payload) ||
    /\[Canvas video\]/i.test(payload) ||
    /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(blob)
  ) {
    return 'video';
  }
  return 'image';
}

export function libraryAssetAttachmentKey(assetId: string): string {
  return `attachment:asset:${assetId}`;
}

/**
 * Ensure a library asset is present as a composer attachment chip.
 * Used by generator `@` pickers (image/video/audio/lottie) so refs stay in the strip.
 * AgentDock chat `@` library picks insert an inline mention only (no strip row).
 */
export function upsertLibraryAssetAttachment(
  existing: ComposerContext[],
  asset: {
    id: string;
    kind: string;
    url?: string | null;
    prompt?: string | null;
    objectKey?: string | null;
  },
  fallbackLabel: string
): { contexts: ComposerContext[]; attachment: ComposerContext; ordinal: number } | null {
  const url = String(asset.url || '').trim();
  if (!url) return null;
  const kind =
    asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image'
      ? asset.kind
      : null;
  if (!kind) return null;
  const key = libraryAssetAttachmentKey(asset.id);
  const found = existing.find((c) => c.key === key || chipBaseKey(c.key) === key);
  let contexts = existing;
  let attachment = found;
  if (!attachment) {
    const promptLabel = String(asset.prompt || '').trim();
    attachment = {
      key,
      label: promptLabel.slice(0, 48) || fallbackLabel,
      kind: 'attachment',
      payload:
        kind === 'video'
          ? `[Attached video]\nid: ${asset.id}\nname: ${promptLabel || asset.id}`
          : kind === 'audio'
            ? `[Attached audio]\nid: ${asset.id}\nname: ${promptLabel || asset.id}`
            : `[Attached image]\nid: ${asset.id}\nname: ${promptLabel || asset.id}`,
      dataUrl: url,
      thumbUrl: url,
      uploadKey: asset.objectKey || undefined,
      uploadStatus: 'ready',
    };
    contexts = [...existing, attachment];
  }
  const attachments = contexts.filter((c) => c.kind === 'attachment');
  const ordinal = Math.max(1, attachments.findIndex((c) => c.key === key) + 1);
  return { contexts, attachment, ordinal };
}

/** Inline `@` chip that references an attachment strip item. */
export function buildAttachRefMentionContext(
  att: ComposerContext,
  label: string,
  payload?: string
): ComposerContext {
  return {
    key: `attach-ref:${chipBaseKey(att.key)}`,
    label,
    kind: 'image',
    payload: payload || att.payload || '[User attachment]',
    ...(att.dataUrl ? { dataUrl: att.dataUrl } : {}),
    ...(att.thumbUrl || att.dataUrl
      ? { thumbUrl: String(att.thumbUrl || att.dataUrl) }
      : {}),
  };
}

/** `@query` at end of composer text → open mention panel. */
export function parseAtMentionQuery(next: string): { open: boolean; query: string } {
  const at = next.lastIndexOf('@');
  if (at < 0) return { open: false, query: '' };
  const after = next.slice(at + 1);
  if (/\s/.test(after)) return { open: false, query: '' };
  return { open: true, query: after };
}

/** Remove trailing `@query` after picking a mention chip. */
export function stripTrailingAtQuery(prev: string): string {
  const at = prev.lastIndexOf('@');
  if (at < 0) return prev;
  const after = prev.slice(at + 1);
  if (/\s/.test(after)) return prev;
  return prev.slice(0, at);
}

/**
 * `/query` skill picker — `/` only when at start or after whitespace
 * (skips mid-token paths like `https://`).
 */
export function parseSlashSkillQuery(next: string): { open: boolean; query: string } {
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i] !== '/') continue;
    const after = next.slice(i + 1);
    if (/\s/.test(after)) return { open: false, query: '' };
    if (i > 0 && !/\s/.test(next[i - 1]!)) continue;
    return { open: true, query: after };
  }
  return { open: false, query: '' };
}

/** Remove trailing `/query` after picking a skill chip. */
export function stripTrailingSlashQuery(prev: string): string {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    if (prev[i] !== '/') continue;
    const after = prev.slice(i + 1);
    if (/\s/.test(after)) return prev;
    if (i > 0 && !/\s/.test(prev[i - 1]!)) continue;
    return prev.slice(0, i);
  }
  return prev;
}

function withChipInstance(key: string): string {
  if (key.includes(CHIP_INSTANCE_SEP)) return key;
  const uid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${key}${CHIP_INSTANCE_SEP}${uid}`;
}

/** Drop browser `<br>` / empty blocks that create a blank line above chips. */
function scrubComposerScaffold(el: HTMLElement) {
  const keep = new Set<Node>();
  for (const chip of Array.from(el.querySelectorAll('[data-composer-chip="1"]'))) {
    keep.add(chip);
    const next = chip.nextSibling;
    if (
      next?.nodeType === Node.TEXT_NODE &&
      (next.textContent || '').includes('\u200b')
    ) {
      keep.add(next);
    }
  }
  if (readPlainText(el).trim() !== '') {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
        node.parentNode?.removeChild(node);
      }
    }
    return;
  }
  for (const node of Array.from(el.childNodes)) {
    if (keep.has(node)) continue;
    node.parentNode?.removeChild(node);
  }
}

function buildChip(
  opts: {
    kind: 'context';
    id: string;
    label: string;
    iconSvg: string;
    thumbUrl?: string;
    /** Skill chips: label + × only when no logo thumb. */
    hideLeadingIcon?: boolean;
    onRemove: () => void;
  }
): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.composerChip = '1';
  chip.dataset.chipStyle = CHIP_STYLE;
  chip.dataset.chipKind = opts.kind;
  chip.dataset.chipId = opts.id;
  // Keep in sync with CONTEXT_CHIP_PILL_CLASS / ContextChipPill.
  chip.className = cn(CONTEXT_CHIP_PILL_CLASS, 'mr-1');

  const thumb = String(opts.thumbUrl || '').trim();
  const parts: HTMLElement[] = [];
  if (thumb) {
    chip.classList.add('pl-1', 'pr-0.5');
    const img = document.createElement('img');
    img.src = thumb;
    img.alt = '';
    img.draggable = false;
    img.className = CONTEXT_CHIP_THUMB_CLASS;
    parts.push(img);
  } else if (!opts.hideLeadingIcon) {
    chip.classList.add('pl-1.5', 'pr-0.5');
    const icon = document.createElement('span');
    icon.className =
      'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[var(--canvas)] text-[var(--muted)] ring-1 ring-[var(--line)]';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = sanitizeSvg(opts.iconSvg);
    parts.push(icon);
  } else {
    chip.classList.add('pl-1.5', 'pr-0.5');
  }

  const label = document.createElement('span');
  label.className = 'truncate font-medium';
  label.textContent = opts.label;
  parts.push(label);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove context');
  remove.className =
    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)]';
  remove.textContent = '×';
  remove.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onRemove();
  });
  parts.push(remove);

  chip.append(...parts);
  return chip;
}

const CONTEXT_ICON = CONTEXT_ICON_SVG;

/** Collect image/video files from a paste / drop DataTransfer. */
function clipboardMediaFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (f: File | null) => {
    if (!f) return;
    const mime = (f.type || '').toLowerCase();
    if (
      !mime.startsWith('image/') &&
      !mime.startsWith('video/') &&
      !mime.startsWith('audio/') &&
      mime !== 'application/json' &&
      mime !== 'text/json' &&
      !/\.json$/i.test(f.name || '')
    ) {
      return;
    }
    const id = `${f.name}:${f.size}:${f.type}:${f.lastModified}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(f);
  };
  try {
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== 'file') continue;
      const t = (item.type || '').toLowerCase();
      if (
        t.startsWith('image/') ||
        t.startsWith('video/') ||
        t.startsWith('audio/') ||
        t === 'application/json' ||
        t === 'text/json'
      ) {
        push(item.getAsFile());
      }
    }
  } catch {
    /* ignore */
  }
  if (!out.length) {
    for (const f of Array.from(data.files || [])) push(f);
  }
  return out;
}

/** Drop bare <img> nodes browsers insert on paste (keep thumbs inside chips). */
function stripOrphanPasteImages(root: HTMLElement) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.closest('[data-composer-chip="1"]')) return;
    img.remove();
  });
}

/** Insert a chip at the saved/plain caret. Does not touch React context state. */
function insertChipAtSavedCaret(
  el: HTMLElement,
  ctx: ComposerContext,
  opts: {
    savedCaretRef: { current: number | null };
    onRemove: (key: string) => void;
    markHasChips: () => void;
  }
): boolean {
  scrubComposerScaffold(el);

  const chip = buildChip({
    kind: 'context',
    id: ctx.key,
    label: ctx.label,
    iconSvg: CONTEXT_ICON,
    thumbUrl: ctx.thumbUrl || ctx.dataUrl,
    hideLeadingIcon: isSkillComposerContext(ctx),
    onRemove: () => opts.onRemove(ctx.key),
  });

  const sel = window.getSelection();
  let range: Range | null = null;
  const plainLen = readPlainText(el).length;
  // Prefer saved caret. Never trust the live selection right after el.focus() —
  // browsers reset it to offset 0 (and may fire select → rememberCaret).
  // Empty composer: always append (avoids inserting after a leftover <br>).
  if (plainLen === 0) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  } else if (opts.savedCaretRef.current != null) {
    range = setPlainTextCaretOffset(el, opts.savedCaretRef.current);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }

  range.deleteContents();
  range.insertNode(chip);
  const spacer = document.createTextNode('\u200b');
  chip.after(spacer);
  scrubComposerScaffold(el);
  // Hide placeholder immediately — don't wait for the React contexts commit.
  opts.markHasChips();

  const next = document.createRange();
  next.setStartAfter(spacer);
  next.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(next);
  opts.savedCaretRef.current = getPlainTextCaretOffset(el);
  return true;
}

function appendComposerChip(
  el: HTMLElement,
  ctx: ComposerContext,
  onRemove: (key: string) => void
) {
  el.appendChild(
    buildChip({
      kind: 'context',
      id: ctx.key,
      label: ctx.label,
      iconSvg: CONTEXT_ICON,
      thumbUrl: ctx.thumbUrl || ctx.dataUrl,
      hideLeadingIcon: isSkillComposerContext(ctx),
      onRemove: () => onRemove(ctx.key),
    })
  );
}

/**
 * Rebuild from `contentMarked` (U+FFFC slots) so edit matches the bubble layout.
 * Leftover chips append at the end.
 */
function writeComposerDomFromMarked(
  el: HTMLElement,
  nextContexts: ComposerContext[],
  marked: string,
  onRemove: (key: string) => void
) {
  el.innerHTML = '';
  let chipIdx = 0;
  const parts = marked.split('\uFFFC');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) el.appendChild(document.createTextNode(part));
    if (i >= parts.length - 1) continue;
    const ctx = nextContexts[chipIdx++];
    if (ctx) appendComposerChip(el, ctx, onRemove);
  }
  while (chipIdx < nextContexts.length) {
    const ctx = nextContexts[chipIdx++];
    if (ctx) appendComposerChip(el, ctx, onRemove);
  }
  const hasChip = nextContexts.length > 0;
  if (hasChip && !el.lastChild) {
    el.appendChild(document.createTextNode('\u200b'));
  }
  if (document.activeElement === el || hasChip) {
    el.focus();
    placeCaretAtEnd(el);
  }
}

/** Full rewrite. Chips go at the saved caret (or end), never forced to index 0.
 *  When `text` includes U+FFFC, treat it as marked layout (bubble → edit). */
function writeComposerDom(
  el: HTMLElement,
  nextContexts: ComposerContext[],
  text: string,
  opts: {
    savedCaretRef: { current: number | null };
    onRemove: (key: string) => void;
    caret?: 'end' | 'preserve';
  }
) {
  const raw = text || '';
  if (raw.includes('\uFFFC')) {
    writeComposerDomFromMarked(el, nextContexts, raw, opts.onRemove);
    opts.savedCaretRef.current = getPlainTextCaretOffset(el);
    return;
  }

  const plain = raw;
  const caret = opts.caret ?? 'end';
  let at =
    caret === 'preserve' && opts.savedCaretRef.current != null
      ? opts.savedCaretRef.current
      : plain.length;
  at = Math.max(0, Math.min(at, plain.length));
  const before = plain.slice(0, at);
  const after = plain.slice(at);

  el.innerHTML = '';
  if (before) el.appendChild(document.createTextNode(before));
  for (const ctx of nextContexts) {
    appendComposerChip(el, ctx, opts.onRemove);
  }
  const hasChip = nextContexts.length > 0;
  el.appendChild(document.createTextNode(after || (hasChip ? '\u200b' : '')));
  if (document.activeElement === el || hasChip) {
    el.focus();
    const range = setPlainTextCaretOffset(el, before.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Place caret after chips when we inserted at `at`.
    if (hasChip) {
      const lastChip = el.querySelector(
        `[data-chip-kind="context"][data-chip-id="${CSS.escape(
          nextContexts[nextContexts.length - 1]!.key
        )}"]`
      );
      const spacer = lastChip?.nextSibling;
      if (spacer) {
        const afterChip = document.createRange();
        afterChip.setStartAfter(spacer);
        afterChip.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(afterChip);
      }
    }
    opts.savedCaretRef.current = getPlainTextCaretOffset(el);
  }
}

/**
 * Contenteditable composer: context chips inline; supports insert-at-caret.
 */
const AgentComposerInput = forwardRef<
  AgentComposerHandle,
  {
    contexts: ComposerContext[];
    onContextsChange: (next: ComposerContext[]) => void;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onEscape?: () => void;
    disabled?: boolean;
    placeholder: string;
    className?: string;
    /**
     * Stable id for canvas→chat fly landing (`agent` | `node:<id>`).
     * Written to `data-fly-land` so picks don't land in another open composer.
     */
    flyLandId?: string;
    /** Paste / drop media → attach strip (do not insert raw <img>). */
    onPasteImages?: (files: File[]) => void;
  }
>(function AgentComposerInput(
  {
    contexts,
    onContextsChange,
    value,
    onChange,
    onSubmit,
    onEscape,
    disabled,
    placeholder,
    className,
    flyLandId,
    onPasteImages,
  },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const contextsRef = useRef(contexts);
  const onContextsChangeRef = useRef(onContextsChange);
  const onChangeRef = useRef(onChange);
  const onPasteImagesRef = useRef(onPasteImages);
  const skipSyncRef = useRef(false);
  /** Last caret offset in plain text — survives blur (e.g. right-click canvas). */
  const savedCaretRef = useRef<number | null>(null);
  /** Ignore select/focus caret noise while programmatically inserting a chip. */
  const insertingRef = useRef(false);
  /**
   * Placeholder follows real DOM chips, not just React `contexts`, so we never
   * paint the hint over a chip that is still mounted (add/remove race).
   */
  const [domHasChips, setDomHasChips] = useState(() => contexts.length > 0);

  contextsRef.current = contexts;
  onContextsChangeRef.current = onContextsChange;
  onChangeRef.current = onChange;
  onPasteImagesRef.current = onPasteImages;

  const syncDomHasChips = () => {
    const next = editorHasComposerChips(editorRef.current);
    setDomHasChips((prev) => (prev === next ? prev : next));
  };

  const removeContextByKey = (key: string) => {
    onContextsChangeRef.current(contextsRef.current.filter((c) => c.key !== key));
  };

  const rememberCaret = () => {
    if (insertingRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    const off = getPlainTextCaretOffset(el);
    if (off != null) savedCaretRef.current = off;
  };

  // Capture caret before canvas/context-menu steals focus (blur selection is already gone).
  // Also blur the editor when clicking outside the composer — SVG canvas clicks do not
  // trigger the browser's default blur on contentEditable elements.
  useLayoutEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      const el = editorRef.current;
      if (!el || disabled) return;
      const t = e.target as Node | null;
      if (!t || el.contains(t)) return;
      rememberCaret();
      // If the editor is focused and the click target is outside the whole composer
      // subtree (not just the editable), blur so the cursor disappears.
      const composerRoot = el.closest('[data-agent-composer-root]') || el.parentElement;
      if (document.activeElement === el && t instanceof Node && !composerRoot?.contains(t)) {
        el.blur();
      }
    };
    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [disabled]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = editorRef.current;
      if (!el) return;
      const alreadyFocused = document.activeElement === el;
      el.focus();
      // Keep mid-text caret when already focused (e.g. click bubbled from editor).
      if (!alreadyFocused) {
        if (savedCaretRef.current != null) {
          const range = setPlainTextCaretOffset(el, savedCaretRef.current);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } else {
          placeCaretAtEnd(el);
          savedCaretRef.current = getPlainTextCaretOffset(el);
        }
      }
    },
    focusEnd: () => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      placeCaretAtEnd(el);
      savedCaretRef.current = getPlainTextCaretOffset(el);
    },
    insertContextAtCaret: (ctx: ComposerContext) => {
      const el = editorRef.current;
      if (!el) return;

      // Block parent-driven rewrite before we mutate the DOM (and the follow-up tick).
      skipSyncRef.current = true;
      // Snapshot before focus(): browsers reset caret to 0 and fire select.
      const caretBeforeFocus = savedCaretRef.current;
      insertingRef.current = true;
      try {
        // Same element can be @-mentioned multiple times — unique instance key each insert.
        const unique: ComposerContext = { ...ctx, key: withChipInstance(ctx.key) };
        onContextsChangeRef.current([...contextsRef.current, unique]);

        el.focus();
        if (caretBeforeFocus != null) savedCaretRef.current = caretBeforeFocus;
        insertChipAtSavedCaret(el, unique, {
          savedCaretRef,
          onRemove: removeContextByKey,
          markHasChips: () => setDomHasChips((prev) => (prev ? prev : true)),
        });

        skipSyncRef.current = true;
        const text = readPlainText(el);
        onChangeRef.current(text);
        // Keep skip through the React commit that follows state updates.
        queueMicrotask(() => {
          skipSyncRef.current = true;
        });
      } finally {
        insertingRef.current = false;
      }
    },
    getMarkedText: () => {
      const el = editorRef.current;
      if (!el) return '';
      return readMarkedText(el);
    },
    getAtMentionAnchorRect: () => {
      const el = editorRef.current;
      return el ? getAtMentionAnchorRect(el) : null;
    },
    getSlashMentionAnchorRect: () => {
      const el = editorRef.current;
      return el ? getTriggerAnchorRect(el, '/') : null;
    },
  }));

  useLayoutEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      syncDomHasChips();
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const currentText = readPlainText(el);
    const domCtxKeys = Array.from(
      el.querySelectorAll('[data-chip-kind="context"]')
    ).map((n) => (n as HTMLElement).dataset.chipId || '');
    const nextCtxKeys = contexts.map((c) => c.key);
    const sameCtx =
      domCtxKeys.length === nextCtxKeys.length &&
      domCtxKeys.every((k) => nextCtxKeys.includes(k)) &&
      nextCtxKeys.every((k) => domCtxKeys.includes(k));
    const chipsStale = Boolean(
      el.querySelector(`[data-composer-chip]:not([data-chip-style="${CHIP_STYLE}"])`)
    );
    if (sameCtx && currentText === value && !chipsStale) {
      // Drop leftover caret <br> that readPlainText ignores but still paints a blank line.
      if (value.trim() !== '') {
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
            node.parentNode?.removeChild(node);
          }
        }
      }
      // DOM already matches React — only fix placeholder flag if it drifted.
      // Use contexts.length (sameCtx ⇒ equivalent to DOM) to avoid extra reads /
      // setState when parent passes a new contexts[] identity each render.
      const next = nextCtxKeys.length > 0;
      setDomHasChips((prev) => (prev === next ? prev : next));
      return;
    }
    // Contexts unchanged but React `value` changed (e.g. cleared after send).
    // Update plain text in place — do not rebuild chips (preserves mid-text chip order).
    if (sameCtx) {
      syncPlainText(el, value);
      syncDomHasChips();
      return;
    }
    // New context chips only appended — insert at saved caret (not DOM end / not index 0).
    // Require plain text already in sync. Empty editor + non-empty `value` (e.g. begin
    // edit user bubble) must writeDom, or insertChip-only + onChange wipes the draft.
    const onlyAppended =
      nextCtxKeys.length > domCtxKeys.length &&
      domCtxKeys.every((k, i) => nextCtxKeys[i] === k) &&
      currentText === value;
    if (onlyAppended) {
      insertingRef.current = true;
      try {
        for (const key of nextCtxKeys.slice(domCtxKeys.length)) {
          const ctx = contexts.find((c) => c.key === key);
          if (!ctx) continue;
          insertChipAtSavedCaret(el, ctx, {
            savedCaretRef,
            onRemove: removeContextByKey,
            markHasChips: () => setDomHasChips((prev) => (prev ? prev : true)),
          });
        }
      } finally {
        insertingRef.current = false;
      }
      skipSyncRef.current = true;
      const text = readPlainText(el);
      if (text !== value) onChangeRef.current(text);
      syncDomHasChips();
      return;
    }
    writeComposerDom(el, contexts, value, {
      savedCaretRef,
      onRemove: removeContextByKey,
      caret: 'preserve',
    });
    // Marked draft (U+FFFC) → plain React value after first paint so later syncs
    // keep mid-text chip order via syncPlainText instead of re-stacking chips at end.
    if (value.includes('\uFFFC')) {
      const plain = readPlainText(el);
      if (plain !== value) onChangeRef.current(plain);
    }
    // After chips are removed from the DOM — only then can the placeholder show.
    syncDomHasChips();
  }, [contexts, value]);

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    rememberCaret();
    const domKeys = Array.from(el.querySelectorAll('[data-chip-kind="context"]')).map(
      (n) => (n as HTMLElement).dataset.chipId || ''
    );
    const nextContexts = contextsRef.current.filter((c) => domKeys.includes(c.key));
    const ordered = domKeys
      .map((k) => nextContexts.find((c) => c.key === k) || contextsRef.current.find((c) => c.key === k))
      .filter(Boolean) as ComposerContext[];
    if (
      ordered.length !== contextsRef.current.length ||
      ordered.some((c, i) => c.key !== contextsRef.current[i]?.key)
    ) {
      onContextsChangeRef.current(ordered);
    }
    const next = readPlainText(el);
    skipSyncRef.current = true;
    onChangeRef.current(next);
  };

  const insertPlainAtCaret = (plain: string) => {
    const el = editorRef.current;
    if (!el || !plain) return;
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    // Single TextNode — much faster than execCommand for large pastes.
    const textNode = document.createTextNode(plain);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handlePaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = clipboardMediaFiles(e.clipboardData);
    if (files.length && onPasteImagesRef.current) {
      e.preventDefault();
      rememberCaret();
      onPasteImagesRef.current(files);
      return;
    }
    // Plain text only — no rich HTML styles; sync React once (skip full DOM rewrite).
    e.preventDefault();
    const plain = String(e.clipboardData?.getData('text/plain') || '');
    if (!plain) return;
    const el = editorRef.current;
    if (!el) return;
    insertPlainAtCaret(plain);
    stripOrphanPasteImages(el);
    skipSyncRef.current = true;
    rememberCaret();
    const next = readPlainText(el);
    onChangeRef.current(next);
    syncDomHasChips();
    queueMicrotask(() => {
      skipSyncRef.current = true;
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onEscape?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key !== 'Backspace') return;
    const el = editorRef.current;
    if (!el) return;
    const text = readPlainText(el);
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const chips = el.querySelectorAll('[data-composer-chip]');
    const lastChip = chips[chips.length - 1] as HTMLElement | undefined;
    const afterChip = lastChip?.nextSibling;
    const atChipEdge =
      !text.trim() ||
      (afterChip && range.startContainer === afterChip && range.startOffset <= 1);
    if (!atChipEdge) return;
    e.preventDefault();
    if (lastChip?.dataset.chipKind === 'context' && lastChip.dataset.chipId) {
      removeContextByKey(lastChip.dataset.chipId);
    }
  };

  const empty = !value.trim();
  // Prefer DOM chip presence so placeholder never overlaps a chip mid-commit.
  const showPlaceholder =
    empty && !domHasChips && contexts.length === 0 && Boolean(placeholder.trim());

  return (
    <div
      className={cn('relative w-full min-w-0 flex-1 cursor-text', className)}
      data-agent-composer-root
      {...(flyLandId ? { 'data-fly-land': flyLandId } : {})}
    >      <div
        ref={editorRef}
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        aria-multiline="true"
        aria-placeholder={showPlaceholder ? placeholder : undefined}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        data-agent-composer
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onKeyUp={rememberCaret}
        onClick={rememberCaret}
        onBlur={rememberCaret}
        onSelect={rememberCaret}
        className={cn(
          'h-full w-full min-h-[26px] max-h-[140px] cursor-text overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-0.5 text-[13px] leading-5 text-[var(--ink)] outline-none',
          '[&_[data-composer-chip]]:align-middle',
          disabled && 'pointer-events-none cursor-default opacity-50'
        )}
      />
      {showPlaceholder ? (
        <div
          className="pointer-events-none absolute inset-0 cursor-text text-[13px] leading-5 text-[var(--muted)]"
          aria-hidden
        >
          {placeholder}
        </div>
      ) : null}
    </div>
  );
});

export default memo(AgentComposerInput);
const MemoizedContextChipPill = memo(ContextChipPill);
export { MemoizedContextChipPill as ContextChipPill };

function nodeKindLabel(node: SceneNodeInput): string {
  const shape = String(node?.attrs?.shapeType || '');
  const key = String(node?.key || '');
  const map: Record<string, string> = {
    text: '文字',
    image: '图片',
    rect: '矩形',
    line: '线条',
    arrow: '箭头',
    ellipse: '椭圆',
    circle: '椭圆',
    triangle: '多边形',
    polygon: '多边形',
    star: '星形',
    pen: '钢笔',
    pencil: '画笔',
    path: '路径',
  };
  return map[shape] || map[key] || key || '元素';
}

/** Unique chip label: 矩形 1 / 矩形 2 / 多边形 1 … (stable by position). */
function numberedNodeLabel(document: SceneDocument, nodeId: string): string {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return '元素';
  const base = nodeKindLabel(node);
  const delta = document?.deltaSetLike || {};
  const peers = Object.keys(delta)
    .filter((id) => {
      const n = delta[id];
      return Boolean(n) && nodeKindLabel(n) === base;
    })
    .sort((a, b) => {
      const na = delta[a];
      const nb = delta[b];
      const ya = Number(na?.y) || 0;
      const yb = Number(nb?.y) || 0;
      if (ya !== yb) return ya - yb;
      const xa = Number(na?.x) || 0;
      const xb = Number(nb?.x) || 0;
      if (xa !== xb) return xa - xb;
      return a.localeCompare(b);
    });
  const idx = Math.max(1, peers.indexOf(nodeId) + 1);
  return `${base} ${idx}`;
}

function nextGroupChipLabel(chips: ComposerContext[]): string {
  let max = 0;
  for (const c of chips) {
    if (c.kind !== 'group' && c.kind !== 'multi') continue;
    const m = /^组(\d+)$/.exec(String(c.label || '').trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `组${max + 1}`;
}

export function buildComposerContext(
  document: SceneDocument,
  selectedNodeIds: string[],
  activeFrameId: string | null,
  /** Existing chips — used to name multi-select as 组1 / 组2 … */
  existingChips: ComposerContext[] = []
): ComposerContext | null {
  const ids = selectedNodeIds.filter(Boolean);
  if (ids.length === 1) {
    const id = ids[0];
    const node = document?.deltaSetLike?.[id];
    if (!node) return null;
    const label = numberedNodeLabel(document, id);
    // Full snapshot (same shape as SCENE_NODES); artboard-local when inside a frame.
    const containingFrameId = frameIdContainingNode(document, id);
    const inventory = containingFrameId
      ? buildSceneNodesForEdit(document, containingFrameId, [id]).find((n) => n.id === id) ||
        buildSceneNodesForIds(document, [id])[0]
      : buildSceneNodesForIds(document, [id])[0];
    const lines = [
      '[Target element — full node; update_node may change any field]',
      containingFrameId ? `artboard_id: ${containingFrameId}` : null,
      inventory ? JSON.stringify(inventory) : `id: ${id}`,
    ].filter(Boolean) as string[];
    return {
      key: `node:${id}`,
      label,
      kind: String(node.key || 'shape'),
      payload: lines.join('\n'),
      ...(node.key === 'image' && String(node.attrs?.src || '').trim()
        ? {
            thumbUrl: String(node.attrs.src).trim(),
            // Same src for vision bag — send() resolves /api → data URL when needed.
            dataUrl: String(node.attrs.src).trim(),
          }
        : {}),
    };
  }
  if (ids.length > 1) {
    const key = `group:${[...ids].sort().join(',')}`;
    const reused = existingChips.find((c) => chipBaseKey(c.key) === key);
    const label = reused?.label || nextGroupChipLabel(existingChips);
    const frameIds = [
      ...new Set(ids.map((id) => frameIdContainingNode(document, id)).filter(Boolean)),
    ] as string[];
    const inventory =
      frameIds.length === 1
        ? buildSceneNodesForEdit(document, frameIds[0], ids).filter((n) => ids.includes(n.id))
        : buildSceneNodesForIds(document, ids);
    return {
      key,
      label,
      kind: 'group',
      payload: [
        '[Target group — full node snapshots; update_node may change any field]',
        `group: ${label}`,
        `count: ${ids.length}`,
        `ids: ${ids.join(', ')}`,
        JSON.stringify(inventory.slice(0, 40)),
      ].join('\n'),
    };
  }

  if (!activeFrameId || !document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const frame = frames.find((f: any) => f?.id === activeFrameId);
  if (!frame) return null;
  const name = String(frame.name || 'Frame');
  const w = Math.round(Number(frame.width) || 0);
  const h = Math.round(Number(frame.height) || 0);
  const fx = Number(frame.x) || 0;
  const fy = Number(frame.y) || 0;
  const fw = Math.max(1, Number(frame.width) || 1);
  const fh = Math.max(1, Number(frame.height) || 1);
  const bg = String(frame.backgroundColor || 'transparent');

  const childLines: string[] = [];
  const rootChildren: string[] = document?.deltaSetLike?.ROOT?.children || [];
  for (const id of rootChildren) {
    const node = document?.deltaSetLike?.[id];
    if (!node || !id) continue;
    const { left, top } = nodeLeftTop(document, node);
    const nw = Math.max(1, Number(node.width) || 1);
    const nh = Math.max(1, Number(node.height) || 1);
    // Treat as inside if the box mostly overlaps the artboard.
    const ow = Math.max(0, Math.min(left + nw, fx + fw) - Math.max(left, fx));
    const oh = Math.max(0, Math.min(top + nh, fy + fh) - Math.max(top, fy));
    if (ow * oh < nw * nh * 0.4) continue;
    const kind = nodeKindLabel(node);
    const nodeLabel = numberedNodeLabel(document, id);
    const fill = String(node.attrs?.['fill-color'] ?? node.attrs?.fill ?? '');
    let line = `- id=${id} name="${nodeLabel}" kind=${kind} box=${Math.round(nw)}×${Math.round(nh)} at (${Math.round(left)},${Math.round(top)})`;
    if (fill) line += ` fill=${fill}`;
    if (node.key === 'text') {
      const preview = parseNodeText(node.attrs || {}).slice(0, 120);
      if (preview) line += ` text="${preview.replace(/\n/g, ' ')}"`;
    }
    childLines.push(line);
    if (childLines.length >= 80) break;
  }

  return {
    key: `frame:${activeFrameId}`,
    label: name,
    kind: 'frame',
    payload: [
      '[Target artboard]',
      `id: ${activeFrameId}`,
      `name: ${name}`,
      `size: ${w}×${h} at (${Math.round(fx)}, ${Math.round(fy)})`,
      `background: ${bg}`,
      `elements (${childLines.length}):`,
      ...(childLines.length
        ? childLines
        : ['(empty artboard — no scene nodes inside yet)']),
    ].join('\n'),
  };
}

/** Attach a live shape/group/frame raster when the chip has no image `src` yet. */
export async function enrichComposerContextThumb(
  document: SceneDocument,
  ctx: ComposerContext | null,
  opts: { nodeIds?: string[]; frameId?: string | null } = {}
): Promise<ComposerContext | null> {
  if (!ctx) return null;
  if (String(ctx.thumbUrl || '').trim()) return ctx;
  try {
    const thumb = await renderComposerChipThumb({
      document,
      nodeIds: opts.nodeIds,
      frameId: opts.frameId,
    });
    if (thumb) return { ...ctx, thumbUrl: thumb };
  } catch {
    /* best-effort preview */
  }
  return ctx;
}

/** Same path as selection export — flatten nodes to one PNG data-URL. */
export async function rasterizeNodesToPngDataUrl(
  document: SceneDocument,
  nodeIds: string[]
): Promise<string | null> {
  const ids = nodeIds.filter(Boolean);
  if (!document || !ids.length) return null;
  try {
    const rendered = await renderExport({
      document,
      format: 'png',
      multiplier: 2,
      selectionOnly: true,
      nodeIds: ids,
    });
    if (rendered?.kind !== 'raster' || !rendered.dataUrl) return null;
    return rendered.dataUrl;
  } catch {
    return null;
  }
}

/** Same path as selection export — flatten nodes to one PNG File for Chat. */
export async function rasterizeNodesToPngFile(
  document: SceneDocument,
  nodeIds: string[],
  filename = 'canvas-group.png'
): Promise<File | null> {
  const dataUrl = await rasterizeNodesToPngDataUrl(document, nodeIds);
  if (!dataUrl) return null;
  try {
    return await imageSrcToFile(dataUrl, filename);
  } catch {
    return null;
  }
}
