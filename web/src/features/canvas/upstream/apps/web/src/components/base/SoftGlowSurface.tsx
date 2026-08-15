/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/SoftGlowSurface.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@recombyn-native/utils/classnames';

/** Soft pastel blooms for list / media loading plates (item covers). */
export const SOFT_GLOW_LIST_TONES = ['rose', 'sky', 'peach', 'lilac', 'mint'] as const;
export type SoftGlowListTone = (typeof SOFT_GLOW_LIST_TONES)[number];
/** `canvas` = fixed artboard / node-plate tone (not random). */
export type SoftGlowTone = SoftGlowListTone | 'canvas';

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable list tone from seed; omit seed for a one-shot random pick. */
export function pickSoftGlowTone(seed?: string | number | null): SoftGlowListTone {
  if (seed == null || seed === '') {
    return SOFT_GLOW_LIST_TONES[Math.floor(Math.random() * SOFT_GLOW_LIST_TONES.length)];
  }
  return SOFT_GLOW_LIST_TONES[hashSeed(seed) % SOFT_GLOW_LIST_TONES.length];
}

export function resolveSoftGlowTone(
  tone: SoftGlowTone | 'random' = 'random',
  seed?: string | number | null
): SoftGlowTone {
  if (tone === 'canvas') return 'canvas';
  if (tone !== 'random') return tone;
  return pickSoftGlowTone(seed);
}

export function softGlowClassName(opts?: {
  /** Keep glow bloom drifting (default on). */
  sweep?: boolean;
  className?: string;
}): string {
  return cn('rcb-soft-glow', opts?.sweep !== false && 'rcb-soft-glow--drift', opts?.className);
}

type SoftGlowSurfaceProps = {
  /** `random` (default) for lists; `canvas` for artboard / node plates. */
  tone?: SoftGlowTone | 'random';
  /** Stable random for list items (index / id). */
  seed?: string | number | null;
  /** Drift the inner pastel bloom (default on). Legacy name: sweep. */
  sweep?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'>;

/**
 * Soft pastel loading surface + drifting bloom (not a horizontal light bar).
 * Lists: tone="random" + seed. Artboard / process plates: tone="canvas".
 */
export function SoftGlowSurface({
  tone = 'random',
  seed,
  sweep = true,
  className,
  style,
  children,
  ...rest
}: SoftGlowSurfaceProps): ReactNode {
  const resolved = resolveSoftGlowTone(tone, seed);
  const delayMs =
    seed == null || seed === '' ? 0 : (hashSeed(seed) % 7) * 420;
  return (
    <div
      className={softGlowClassName({ sweep, className })}
      data-glow={resolved}
      style={{
        ...style,
        ['--rcb-glow-delay' as string]: `${delayMs}ms`,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
