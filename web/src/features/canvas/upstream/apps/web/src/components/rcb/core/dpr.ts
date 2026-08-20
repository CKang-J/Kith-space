/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/dpr.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Device-pixel helpers.
 * Browser zoom changes `window.devicePixelRatio`. We snap:
 * 1) camera world `translate`, and
 * 2) each infinite-SVG surface origin (CSS left === viewBox min) under
 *    fractional DPR — so grid + hosts share one device-pixel lattice without
 *    moving absolute scene content.
 */

/** Greatest common divisor. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Smallest integer `m` such that `dpr * m` is (nearly) an integer.
 * Typical: dpr 2 → 1, 2.5 → 2, 2.25 → 4, 0.9 → 10.
 *
 * Important: use Math.round (not floor) — at 90% zoom Chrome reports
 * `0.899999976` which floor→0.89→multiple 100 (useless).
 */
export function nearestDprMultiple(dpr: number): number {
  const rounded = Math.round(dpr * 100) / 100;
  const decimal = String(rounded).split('.')[1];
  if (!decimal) return 1;
  const denominator = 10 ** decimal.length;
  const numerator = parseInt(decimal, 10);
  return denominator / gcd(numerator, denominator);
}

/** Round CSS transform scalars (`toDomPrecision`). */
export function toDomPrecision(v: number) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Snap a CSS-pixel value onto the device-pixel grid.
 * At dpr=0.75: rounds so `css * dpr` is an integer.
 */
export function snapCssToDevicePixel(cssPx: number, dpr: number): number {
  const d = dpr > 0 ? dpr : 1;
  return Math.round(cssPx * d) / d;
}

export function readDevicePixelRatio(win: Window = window): number {
  const n = Number(win.devicePixelRatio);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Subscribe to browser zoom / resolution changes via matchMedia
 * (MDN: monitoring devicePixelRatio).
 * Returns an unsubscribe function.
 */
export function subscribeDevicePixelRatio(
  onChange: (dpr: number) => void,
  win: Window = window
): () => void {
  if (typeof win.matchMedia !== 'function') {
    onChange(readDevicePixelRatio(win));
    return () => undefined;
  }

  let remove: (() => void) | null = null;

  const update = () => {
    remove?.();
    const dpr = readDevicePixelRatio(win);
    onChange(dpr);
    const mq = win.matchMedia(`(resolution: ${dpr}dppx)`);
    const safariCb = (ev: MediaQueryListEvent | Event) => {
      if ((ev as MediaQueryListEvent).type === 'change' || (ev as MediaQueryListEvent).matches != null) {
        update();
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      remove = () => mq.removeEventListener('change', update);
    } else {
      (mq as MediaQueryList & { addListener: (cb: (ev: MediaQueryListEvent) => void) => void }).addListener(
        safariCb as (ev: MediaQueryListEvent) => void
      );
      remove = () =>
        (
          mq as MediaQueryList & { removeListener: (cb: (ev: MediaQueryListEvent) => void) => void }
        ).removeListener(safariCb as (ev: MediaQueryListEvent) => void);
    }
  };

  update();
  return () => remove?.();
}
