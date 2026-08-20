/**
 * Map viewport client coords onto image-local scene px using the overlay's
 * screen rect. `rcbSceneToScreen` is stage-local; subtracting it from
 * `clientX` is wrong when Chat sits to the left of the canvas.
 */
export function markLocalFromClientRect(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number } | null | undefined,
  cw: number,
  ch: number,
): { x: number; y: number; inside: boolean } {
  if (!rect || !rect.width || !rect.height) {
    return { x: 0, y: 0, inside: false };
  }
  const lx = ((clientX - rect.left) / rect.width) * cw;
  const ly = ((clientY - rect.top) / rect.height) * ch;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  return {
    x: Math.max(0, Math.min(cw, lx)),
    y: Math.max(0, Math.min(ch, ly)),
    inside:
      clientX >= rect.left &&
      clientX <= right &&
      clientY >= rect.top &&
      clientY <= bottom,
  };
}
