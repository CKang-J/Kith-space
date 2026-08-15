export function installNativePerformanceProbe(root: HTMLElement): () => void {
  const samples: number[] = [];
  const record = () => {
    const inputAt = performance.now();
    requestAnimationFrame(() => {
      samples.push(performance.now() - inputAt);
      if (samples.length > 240) samples.shift();
      const sorted = [...samples].sort((a, b) => a - b);
      const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
      root.dataset.stageOneInputFrameSamples = String(sorted.length);
      root.dataset.stageOneInputFrameP50Ms = percentile(0.5).toFixed(2);
      root.dataset.stageOneInputFrameP95Ms = percentile(0.95).toFixed(2);
    });
  };
  const recordActivePointer = (event: PointerEvent) => {
    if (event.buttons !== 0) record();
  };
  root.addEventListener("pointermove", recordActivePointer, true);
  root.addEventListener("wheel", record, { capture: true, passive: true });
  return () => {
    root.removeEventListener("pointermove", recordActivePointer, true);
    root.removeEventListener("wheel", record, true);
  };
}
