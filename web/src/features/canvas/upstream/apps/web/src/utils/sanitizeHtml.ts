/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/sanitizeHtml.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * XSS sanitizer for HTML sinks (preview HTML, icon SVG, etc.).
 * Uses DOMPurify — prefer this over ad-hoc string filters.
 */
import DOMPurify from 'dompurify';
import type { Config } from 'dompurify';

const HTML_CFG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target', 'rel'],
};

const SVG_CFG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject'],
  ALLOW_DATA_ATTR: false,
};

/** Sanitize untrusted HTML (markdown preview, rich paste, etc.). */
export function sanitizeHtml(dirty: string): string {
  const raw = String(dirty || '');
  if (!raw) return '';
  return DOMPurify.sanitize(raw, HTML_CFG);
}

/** Sanitize SVG markup before assigning to innerHTML / dangerouslySetInnerHTML. */
export function sanitizeSvg(dirty: string): string {
  const raw = String(dirty || '');
  if (!raw) return '';
  return DOMPurify.sanitize(raw, SVG_CFG);
}
