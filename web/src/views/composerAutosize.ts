const COMPOSER_INPUT_MAX_HEIGHT = 160;

type ComposerInputElement = Pick<
  HTMLTextAreaElement,
  "clientWidth" | "scrollHeight" | "style"
>;

export function autosizeComposerInput(input: ComposerInputElement) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, COMPOSER_INPUT_MAX_HEIGHT)}px`;
}

export function observeComposerInputWidth(input: ComposerInputElement) {
  let previousWidth = input.clientWidth;
  const observer = new ResizeObserver(() => {
    const width = input.clientWidth;
    if (width === previousWidth) return;
    previousWidth = width;
    autosizeComposerInput(input);
  });
  observer.observe(input as HTMLTextAreaElement);
  return () => observer.disconnect();
}
