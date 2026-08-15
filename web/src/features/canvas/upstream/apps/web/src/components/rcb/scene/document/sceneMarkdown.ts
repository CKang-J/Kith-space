/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneMarkdown.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Lightweight markdown helpers for scene text nodes.
 * Canvas text renders plain text; `attrs.markdown` keeps the source.
 */
import { sanitizeHtml } from '@recombyn-native/utils/sanitizeHtml';

export function markdownToPlain(md: string): string {
  let s = String(md || '');
  // code fences → inner text
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');
  // images ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // headings
  s = s.replace(/^#{1,6}\s+/gm, '');
  // blockquote
  s = s.replace(/^>\s?/gm, '');
  // unordered / ordered lists
  s = s.replace(/^[\t ]*[-*+]\s+/gm, '• ');
  s = s.replace(/^[\t ]*\d+\.\s+/gm, '');
  // bold / italic / strike / code
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1');
  s = s.replace(/_(.+?)_/g, '$1');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  // horizontal rules
  s = s.replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Escape HTML entities. */
function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Safe-ish markdown → HTML for preview only (no raw HTML passthrough).
 * Supports: headings, bold/italic/strike/code, links, lists, quotes, hr, paragraphs.
 */
export function markdownToSafeHtml(md: string): string {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeBuf: string[] = [];

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  const inline = (raw: string) => {
    let t = esc(raw);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    t = t.replace(/_(.+?)_/g, '<em>$1</em>');
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
    t = t.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return t;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeLists();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      out.push('<hr />');
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`);
      continue;
    }

    const ul = /^[\t ]*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = /^[\t ]*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`);
  closeLists();
  const html = out.join('') || '<p class="md-empty"></p>';
  return sanitizeHtml(html);
}

/** Wrap selection in a textarea with markdown markers. */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string = before
): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  if (selected) {
    return {
      value: next,
      selectionStart: start,
      selectionEnd: start + before.length + selected.length + after.length,
    };
  }
  const cursor = start + before.length;
  return { value: next, selectionStart: cursor, selectionEnd: cursor };
}

/** Prefix each selected line (or current line) with a marker. */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string
): { value: string; selectionStart: number; selectionEnd: number } {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndIdx = value.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd);
  const nextBlock = block
    .split('\n')
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
    .join('\n');
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}
