import { useEffect, useMemo, useState } from "react";
import { CanvasPreviewSceneSvg } from "./CanvasPreviewSceneSvg";
import { renderCanvasSelectionThumbnail, selectionPreviewSceneDocument } from "./canvasSelectionPreview";

export function CanvasSelectionThumbnail({
  document,
  selectedIds,
  title,
  maxEdge = 128,
}: {
  document: unknown;
  selectedIds?: readonly string[];
  title: string;
  maxEdge?: number;
}) {
  const [renderedThumbnail, setRenderedThumbnail] = useState<string | null>(null);
  const [useSvgFallback, setUseSvgFallback] = useState(false);
  const selectionKey = selectedIds?.join("\0") ?? "";
  const sceneDocument = useMemo(
    () => selectionPreviewSceneDocument(document, selectedIds),
    [document, selectionKey, selectedIds],
  );

  useEffect(() => {
    let active = true;
    setRenderedThumbnail(null);
    setUseSvgFallback(false);
    void renderCanvasSelectionThumbnail(document, selectedIds, maxEdge)
      .then((thumbnail) => {
        if (!active) return;
        if (thumbnail) {
          setRenderedThumbnail(thumbnail);
          setUseSvgFallback(false);
          return;
        }
        setUseSvgFallback(Boolean(sceneDocument));
      })
      .catch(() => {
        if (active) setUseSvgFallback(Boolean(sceneDocument));
      });
    return () => {
      active = false;
    };
  }, [document, maxEdge, sceneDocument, selectionKey, selectedIds]);

  if (renderedThumbnail) {
    return (
      <img
        src={renderedThumbnail}
        alt={title}
        className="canvas-selection-thumbnail__image"
        loading="lazy"
        draggable={false}
      />
    );
  }

  if (useSvgFallback && sceneDocument) {
    return <CanvasPreviewSceneSvg document={sceneDocument} title={title} className="canvas-selection-thumbnail__svg" />;
  }

  return <span className="canvas-selection-thumbnail__loading" aria-hidden="true" />;
}
