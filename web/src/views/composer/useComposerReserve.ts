import { useLayoutEffect, useRef } from "react";

const MESSAGE_GAP = 12;
const BOTTOM_THRESHOLD = 24;

export function useComposerReserve() {
  const composerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    const chat = composer?.parentElement;
    if (!composer || !chat?.matches("main.content-col")) return;
    let frame = 0;

    const update = () => {
      const scroll = chat.querySelector<HTMLElement>(":scope > .scroll");
      const wasAtBottom = !!scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= BOTTOM_THRESHOLD;
      chat.style.setProperty("--chat-composer-reserve", `${Math.ceil(composer.getBoundingClientRect().height + MESSAGE_GAP)}px`);
      cancelAnimationFrame(frame);
      if (wasAtBottom && scroll) frame = requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chat.style.removeProperty("--chat-composer-reserve");
    };
  }, []);

  return composerRef;
}
