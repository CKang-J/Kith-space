// Image lightbox: focused media panel with scroll-to-zoom, drag-to-pan, double-click to reset, Esc/backdrop
// to close. Portaled to document.body so position:fixed is viewport-relative (not relative to a message
// row's enter-animation transform). Shared by all message and attachment surfaces so an image
// preview opens a floating dialog in place instead of navigating the browser to the raw asset.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import i18n from "./i18n";
import { adjacentImageId } from "./lightboxNavigation.ts";

export interface LightboxImage {
  id: string;
  src: string;
  alt: string;
}

export function Lightbox({ images, initialImageId, onClose }: { images: readonly LightboxImage[]; initialImageId: string; onClose: () => void }) {
  const [currentImageId, setCurrentImageId] = useState(initialImageId);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reset = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, []);
  const zoom = useCallback((factor: number) => {
    if (factor < 1) setPos({ x: 0, y: 0 });
    setScale((current) => Math.min(8, Math.max(.25, current * factor)));
  }, []);
  const foundIndex = images.findIndex((image) => image.id === currentImageId);
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const currentImage = images[currentIndex];
  const move = useCallback((delta: -1 | 1) => {
    const nextImageId = adjacentImageId(images, currentImageId, delta);
    if (!nextImageId) return;
    setCurrentImageId(nextImageId);
    reset();
  }, [currentImageId, images, reset]);
  useEffect(() => {
    prevFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      prevFocus.current?.focus();
    };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") { e.preventDefault(); zoom(1.25); }
      if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") { e.preventDefault(); zoom(.8); }
      if (e.key === "0" || e.code === "Numpad0") { e.preventDefault(); reset(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      if (e.key === "Tab") {
        const controls = Array.from(document.querySelectorAll<HTMLButtonElement>(".lightbox-control:not(:disabled)"));
        if (!controls.length) return;
        e.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        controls[(index + (e.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [move, reset, zoom]);
  if (!currentImage) return null;
  return createPortal(
    <div className="lightbox-bg" role="dialog" aria-modal="true" aria-label={currentImage.alt} onClick={() => onCloseRef.current()} onWheel={(e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : .89); }}>
      <button ref={closeRef} className="lightbox-control lightbox-x" onClick={() => onCloseRef.current()} aria-label={i18n.t("chat.close")}><X size={20} /></button>
      {images.length > 1 ? <button type="button" className="lightbox-control lightbox-nav lightbox-prev" disabled={currentIndex === 0} onClick={(e) => { e.stopPropagation(); move(-1); }} aria-label={i18n.t("chat.previousImage")} title={`${i18n.t("chat.previousImage")} (←)`}><ChevronLeft size={24} /></button> : null}
      {images.length > 1 ? <button type="button" className="lightbox-control lightbox-nav lightbox-next" disabled={currentIndex === images.length - 1} onClick={(e) => { e.stopPropagation(); move(1); }} aria-label={i18n.t("chat.nextImage")} title={`${i18n.t("chat.nextImage")} (→)`}><ChevronRight size={24} /></button> : null}
      <div className="lightbox-panel" onClick={() => onCloseRef.current()}>
        <img key={currentImage.id} src={currentImage.src} alt={currentImage.alt} className="lightbox-img" draggable={false}
          style={{ transform: `translate(${pos.x}px,${pos.y}px) scale(${scale})`, cursor: scale > 1 ? (drag.current ? "grabbing" : "grab") : "zoom-in" }}
          onClick={(e) => { e.stopPropagation(); if (scale === 1) zoom(2); }}
          onDoubleClick={(e) => { e.stopPropagation(); reset(); }}
          onMouseDown={(e) => { if (scale > 1) { e.preventDefault(); drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; } }}
          onMouseMove={(e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
          onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }} />
      </div>
      <div className="lightbox-toolbar" role="toolbar" aria-label={i18n.t("chat.imageZoomControls")} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-control" onClick={() => zoom(.8)} aria-label={i18n.t("chat.zoomOut")} title={`${i18n.t("chat.zoomOut")} (-)`}><Minus size={17} /></button>
        <button type="button" className="lightbox-control lightbox-scale" onClick={reset} aria-label={i18n.t("chat.resetZoom")} title={`${i18n.t("chat.resetZoom")} (0)`}>{Math.round(scale * 100)}%</button>
        <button type="button" className="lightbox-control" onClick={() => zoom(1.25)} aria-label={i18n.t("chat.zoomIn")} title={`${i18n.t("chat.zoomIn")} (+)`}><Plus size={17} /></button>
        {images.length > 1 ? <span className="lightbox-position" role="status" aria-live="polite" aria-atomic="true" aria-label={`${currentImage.alt}, ${i18n.t("chat.imagePosition", { current: currentIndex + 1, total: images.length })}`}>{currentIndex + 1}/{images.length}</span> : null}
      </div>
    </div>,
    document.body,
  );
}
