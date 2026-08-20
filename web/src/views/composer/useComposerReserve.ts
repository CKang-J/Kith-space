import { useLayoutEffect, useRef } from "react";

const MESSAGE_GAP = 12;
const BOTTOM_THRESHOLD = 24;

export function measureVerticalScrollbar(element: Pick<HTMLElement, "clientWidth" | "offsetWidth">) {
  return Math.max(0, element.offsetWidth - element.clientWidth);
}

export function useComposerReserve() {
  const composerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    const host = composer?.parentElement;
    if (!composer || !host?.matches("main.content-col, aside.thread-panel")) return;
    const scroll = host.querySelector<HTMLElement>(":scope > .scroll");
    if (!scroll) return;
    let frame = 0;

    const update = () => {
      const wasAtBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= BOTTOM_THRESHOLD;

      // The message list owns the native scrollbar while Composer is its sibling.
      // Measure each panel instead of assuming the CSS scrollbar size: overlay
      // scrollbars consume 0px, while classic scrollbars consume layout width.
      // Both siblings then resolve the same visible 16px message rail.
      host.style.setProperty("--chat-scrollbar-width", `${measureVerticalScrollbar(scroll)}px`);
      host.style.setProperty("--chat-composer-reserve", `${Math.ceil(composer.getBoundingClientRect().height + MESSAGE_GAP)}px`);
      cancelAnimationFrame(frame);
      if (wasAtBottom) frame = requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    observer.observe(scroll);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.style.removeProperty("--chat-composer-reserve");
      host.style.removeProperty("--chat-scrollbar-width");
    };
  }, []);

  return composerRef;
}
