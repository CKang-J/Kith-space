// Reveal scrollbars briefly while a surface is actively scrolling, then let them fade back out.
const timers = new WeakMap<HTMLElement, number>();

document.addEventListener("scroll", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  target.classList.add("is-scrolling");
  const previous = timers.get(target);
  if (previous) window.clearTimeout(previous);
  timers.set(target, window.setTimeout(() => {
    target.classList.remove("is-scrolling");
    timers.delete(target);
  }, 700));
}, true);
