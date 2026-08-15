/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/templates/TemplateThumbnail.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useState, memo } from 'react';
import { SoftGlowSurface } from '@recombyn-native/components/base';
import {
  PREVIEW_PNG_MAX_EDGE,
  renderDocumentThumbnail,
  type ThumbRasterOptions,
} from '@recombyn-native/utils/renderProjectThumbnail';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

function isEmptyDocument(document: SceneDocument) {
  const children = document?.deltaSetLike?.ROOT?.children;
  return !Array.isArray(children) || children.length === 0;
}

/**
 * List-card preview — always a raster `<img>`, never a live SVG in the DOM.
 * (SVG is only used off-screen while rasterizing.)
 *
 * Letterbox / empty plate uses `--canvas` so dark mode chrome stays dark;
 * artboard paper color is already in the raster itself.
 */
function TemplateThumbnail({
  document,
  fit = 'contain',
  /** Prefer remote HD PNG URLs (after plaza approve) over client raster. */
  imageUrl,
  format = 'webp',
  maxEdge,
}: {
  document?: any;
  /** `cover` fills the card; `contain` letterboxes. */
  fit?: 'contain' | 'cover';
  imageUrl?: string | null;
  format?: ThumbRasterOptions['format'];
  maxEdge?: number;
}) {
  const remote = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : '';
  const empty = !remote && (!document || isEmptyDocument(document));
  const [src, setSrc] = useState<string | null>(remote || null);

  useEffect(() => {
    if (remote) {
      setSrc(remote);
      return undefined;
    }
    if (empty) {
      setSrc(null);
      return undefined;
    }
    let cancelled = false;
    setSrc(null);
    const edge =
      maxEdge ?? (format === 'png' ? PREVIEW_PNG_MAX_EDGE : undefined);
    async function renderThumb() {
      const url = await renderDocumentThumbnail(document, { format, maxEdge: edge });
      if (!cancelled) setSrc(url);
    }
    void renderThumb();
    return () => {
      cancelled = true;
    };
  }, [document, empty, remote, format, maxEdge]);

  if (empty) {
    return <div className="h-full w-full bg-[var(--canvas)]" />;
  }

  if (!src) {
    return <SoftGlowSurface className="h-full w-full" seed="thumb" aria-hidden />;
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--canvas)]">
      <img
        src={src}
        alt=""
        draggable={false}
        className={
          fit === 'cover'
            ? 'h-full w-full object-cover'
            : 'h-full w-full object-contain'
        }
      />
    </div>
  );
}

export default memo(TemplateThumbnail);
