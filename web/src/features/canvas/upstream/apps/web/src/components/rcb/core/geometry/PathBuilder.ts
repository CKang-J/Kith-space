/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/geometry/PathBuilder.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Lightweight path builder.
 * Geometry truth is the path `d`; stroke/fill are paint along it.
 */

export type Pt = { x: number; y: number };

export class PathBuilder {
  private parts: string[] = [];

  moveTo(x: number, y: number): this {
    this.parts.push(`M ${x} ${y}`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.parts.push(`L ${x} ${y}`);
    return this;
  }

  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.parts.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
    return this;
  }

  close(): this {
    this.parts.push('Z');
    return this;
  }

  /** Start a new subpath without closing the previous one. */
  break(): this {
    return this;
  }

  toD(): string {
    return this.parts.join(' ');
  }

  static fromD(d: string): PathBuilder {
    const b = new PathBuilder();
    const raw = String(d || '').trim();
    if (raw) b.parts.push(raw);
    return b;
  }

  static polyline(points: Pt[], closed = false): PathBuilder {
    const b = new PathBuilder();
    if (points.length < 1) return b;
    b.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      b.lineTo(points[i].x, points[i].y);
    }
    if (closed && points.length >= 3) b.close();
    return b;
  }

  /** Unit box [0,w]×[0,h] ellipse via 4 cubic Béziers. */
  static ellipse(w: number, h: number): PathBuilder {
    const rx = Math.max(0.5, w / 2);
    const ry = Math.max(0.5, h / 2);
    const cx = rx;
    const cy = ry;
    const kx = rx * 0.5522847498;
    const ky = ry * 0.5522847498;
    return new PathBuilder()
      .moveTo(cx, cy - ry)
      .curveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
      .curveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
      .curveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
      .curveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
      .close();
  }

  /**
   * Ellipse / donut / pie / annular sector in box [0,w]×[0,h].
   * - `innerRatio`: hole as fraction of outer radii (0 = solid)
   * - `arcPercent`: signed remaining sweep as % of full turn (−100..100)
   * - `startDeg`: fixed 开始位置 in atan2 degrees (0 = east, 90 = south)
   *   |100| = closed ring/disk. Compound paths use evenodd fill.
   */
  static ellipseVariant(
    w: number,
    h: number,
    opts?: { innerRatio?: number; arcPercent?: number; startDeg?: number }
  ): PathBuilder {
    const rx = Math.max(0.5, w / 2);
    const ry = Math.max(0.5, h / 2);
    const cx = rx;
    const cy = ry;
    const inner = Math.max(0, Math.min(0.92, Number(opts?.innerRatio) || 0));
    const rawArc = Number(opts?.arcPercent);
    const arc = Number.isFinite(rawArc) ? rawArc : 100;
    const absPct = Math.min(100, Math.max(0.5, Math.abs(arc)));
    const positiveDir = !(arc < 0);
    const rawStart = Number(opts?.startDeg);
    const startDeg = Number.isFinite(rawStart) ? rawStart : 90;
    const startRad = ((((startDeg % 360) + 360) % 360) * Math.PI) / 180;
    const irx = Math.max(0.25, rx * inner);
    const iry = Math.max(0.25, ry * inner);
    const hasHole = inner > 1e-4;

    if (absPct >= 99.95) {
      if (!hasHole) return PathBuilder.ellipse(w, h);
      // Full donut: outer + reverse inner (evenodd).
      const b = PathBuilder.ellipse(w, h);
      const kx = irx * 0.5522847498;
      const ky = iry * 0.5522847498;
      b.moveTo(cx, cy - iry)
        .curveTo(cx - kx, cy - iry, cx - irx, cy - ky, cx - irx, cy)
        .curveTo(cx - irx, cy + ky, cx - kx, cy + iry, cx, cy + iry)
        .curveTo(cx + kx, cy + iry, cx + irx, cy + ky, cx + irx, cy)
        .curveTo(cx + irx, cy - ky, cx + kx, cy - iry, cx, cy - iry)
        .close();
      return b;
    }

    const sweep = (absPct / 100) * Math.PI * 2;
    const a0 = startRad;
    const a1 = positiveDir ? a0 + sweep : a0 - sweep;
    const large: 0 | 1 = sweep > Math.PI ? 1 : 0;
    // SVG sweep-flag 1 = clockwise in y-down = atan2-increasing = positiveDir.
    const sweepFlag: 0 | 1 = positiveDir ? 1 : 0;
    const backFlag: 0 | 1 = positiveDir ? 0 : 1;
    const ox0 = cx + rx * Math.cos(a0);
    const oy0 = cy + ry * Math.sin(a0);
    const ox1 = cx + rx * Math.cos(a1);
    const oy1 = cy + ry * Math.sin(a1);

    if (!hasHole) {
      return new PathBuilder()
        .moveTo(cx, cy)
        .lineTo(ox0, oy0)
        .arcTo(rx, ry, large, sweepFlag, ox1, oy1)
        .close();
    }

    const ix0 = cx + irx * Math.cos(a0);
    const iy0 = cy + iry * Math.sin(a0);
    const ix1 = cx + irx * Math.cos(a1);
    const iy1 = cy + iry * Math.sin(a1);
    // Annular sector: outer along sweep, then inner back.
    return new PathBuilder()
      .moveTo(ox0, oy0)
      .arcTo(rx, ry, large, sweepFlag, ox1, oy1)
      .lineTo(ix1, iy1)
      .arcTo(irx, iry, large, backFlag, ix0, iy0)
      .close();
  }

  /** SVG elliptical arc (absolute). */
  arcTo(
    rx: number,
    ry: number,
    largeArc: 0 | 1,
    sweep: 0 | 1,
    x: number,
    y: number
  ): this {
    this.parts.push(`A ${rx} ${ry} 0 ${largeArc} ${sweep} ${x} ${y}`);
    return this;
  }
}
