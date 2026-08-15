/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/SmartGuidesOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Smart guides as scene-space SVG under the shared world surface.
 * Must portal into `data-rcb-smart-guides-mount` — a sibling
 * `sceneSurfaceSvgProps` SVG snaps its origin independently under fractional
 * browser DPR and drifts vs the pixel grid (same bug as shape draw preview).
 * Snap math stays in alignGuides; this file only paints.
 *
 * Paint contract: one continuous stroke per guide, then small dots at marks.
 * Do not draw × arms on the guide — those read as "broken" segments at high zoom.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import { CHROME_STROKE_PX } from '../SelectionChrome';
import {
  SMART_GUIDE_COLOR,
  type SceneBox,
  type SmartGuideGap,
  type SmartGuideLine,
} from '../alignGuides';
import {
  getSceneSmartGuidesMount,
  getSceneWorldEpoch,
  subscribeShapeHosts,
} from '../../shapes/shapeHostRegistry';

const GUIDE_STROKE = SMART_GUIDE_COLOR;
const SIZE_BADGE_FILL = '#3388ff';

function isGapGuide(g: SmartGuideLine): g is SmartGuideGap {
  return g.kind === 'gap';
}

function GuideBadge({
  text,
  x,
  y,
  inv,
  anchor,
  fill = GUIDE_STROKE,
}: {
  text: string;
  x: number;
  y: number;
  inv: number;
  anchor: 'below' | 'right';
  fill?: string;
}) {
  const fontSize = 11 * inv;
  const padX = 5.5 * inv;
  const padY = 2.25 * inv;
  const radius = 4 * inv;
  const gap = 6 * inv;
  const tw = Math.max(14 * inv, String(text).length * fontSize * 0.62);
  const th = fontSize * 1.2;
  const w = tw + padX * 2;
  const h = th + padY * 2;
  const cx = anchor === 'right' ? x + gap + w / 2 : x;
  const cy = anchor === 'below' ? y + gap + h / 2 : y;
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={radius}
        ry={radius}
        fill={fill}
      />
      <text
        x={cx}
        y={cy}
        fill="#fff"
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

/** Filled dot on a guide — does not interrupt the continuous stroke. */
function GuideMarkDot({ x, y, r }: { x: number; y: number; r: number }) {
  return <circle cx={x} cy={y} r={r} fill={GUIDE_STROKE} stroke="none" />;
}

function formatSizeBadge(box: SceneBox): string {
  const w = Math.max(0, Math.round(box.width));
  const h = Math.max(0, Math.round(box.height));
  return `${w} × ${h}`;
}

export default function SmartGuidesOverlay({
  guides,
  mirrorNodeId: _mirrorNodeId = null,
  sizeBox = null,
}: {
  guides: SmartGuideLine[];
  /** Kept for call-site compat. */
  mirrorNodeId?: string | null;
  /** Idle or inspect: blue WxH badge under the selected box. */
  sizeBox?: SceneBox | null;
}) {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;
  // Keep ≥1 CSS px under camera scale so the guide never drops to a dashed hairline.
  const stroke = Math.max(1 / z, CHROME_STROKE_PX / z);
  const tip = 5 * inv;
  const markR = Math.max(stroke * 2, 3.5 * inv);
  const dash = `${5 * inv} ${4 * inv}`;

  // Remount when shared world SVG appears / is replaced.
  const [, setWorldEpoch] = useState(() => getSceneWorldEpoch());
  useEffect(
    () =>
      subscribeShapeHosts(() => {
        setWorldEpoch((prev) => {
          const next = getSceneWorldEpoch();
          return prev === next ? prev : next;
        });
      }),
    []
  );
  const guidesMount = getSceneSmartGuidesMount();

  const nodes = useMemo(() => {
    if (!guides.length && !sizeBox) return null;
    const out: ReactNode[] = [];
    guides.forEach((g, i) => {
      if (isGapGuide(g)) {
        const x0 = g.axis === 'x' ? Math.min(g.from, g.to) : g.at;
        const x1 = g.axis === 'x' ? Math.max(g.from, g.to) : g.at;
        const y0 = g.axis === 'y' ? Math.min(g.from, g.to) : g.at;
        const y1 = g.axis === 'y' ? Math.max(g.from, g.to) : g.at;
        const midX = g.axis === 'x' ? (g.from + g.to) / 2 : g.at;
        const midY = g.axis === 'y' ? (g.from + g.to) / 2 : g.at;
        out.push(
          <g key={`gap-${i}`}>
            {g.rails?.map((rail, ri) => (
              <line
                key={`rail-${ri}`}
                x1={g.axis === 'y' ? Math.min(rail.from, rail.to) : rail.at}
                y1={g.axis === 'y' ? rail.at : Math.min(rail.from, rail.to)}
                x2={g.axis === 'y' ? Math.max(rail.from, rail.to) : rail.at}
                y2={g.axis === 'y' ? rail.at : Math.max(rail.from, rail.to)}
                stroke={GUIDE_STROKE}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeLinecap="butt"
                shapeRendering="geometricPrecision"
              />
            ))}
            <line
              x1={g.axis === 'x' ? x0 : g.at}
              y1={g.axis === 'x' ? g.at : y0}
              x2={g.axis === 'x' ? x1 : g.at}
              y2={g.axis === 'x' ? g.at : y1}
              stroke={GUIDE_STROKE}
              strokeWidth={stroke}
              strokeLinecap="butt"
              shapeRendering="geometricPrecision"
            />
            {g.axis === 'x' ? (
              <path
                d={`M ${x0 + tip} ${g.at - tip} L ${x0} ${g.at} L ${x0 + tip} ${g.at + tip} M ${x1 - tip} ${g.at - tip} L ${x1} ${g.at} L ${x1 - tip} ${g.at + tip}`}
                fill="none"
                stroke={GUIDE_STROKE}
                strokeWidth={stroke}
              />
            ) : (
              <path
                d={`M ${g.at - tip} ${y0 + tip} L ${g.at} ${y0} L ${g.at + tip} ${y0 + tip} M ${g.at - tip} ${y1 - tip} L ${g.at} ${y1} L ${g.at + tip} ${y1 - tip}`}
                fill="none"
                stroke={GUIDE_STROKE}
                strokeWidth={stroke}
              />
            )}
            <GuideBadge
              text={String(g.dist)}
              x={midX}
              y={midY}
              inv={inv}
              anchor={g.axis === 'x' ? 'below' : 'right'}
            />
          </g>
        );
        return;
      }
      // Continuous align stroke first; dots on top (no × that reads as dashed).
      out.push(
        <g key={`align-${i}`}>
          <line
            x1={g.axis === 'x' ? g.at : g.from}
            y1={g.axis === 'x' ? g.from : g.at}
            x2={g.axis === 'x' ? g.at : g.to}
            y2={g.axis === 'x' ? g.to : g.at}
            stroke={GUIDE_STROKE}
            strokeWidth={stroke}
            strokeLinecap="butt"
            shapeRendering="geometricPrecision"
          />
          {(g.marks || []).map((m, mi) => (
            <GuideMarkDot key={mi} x={m.x} y={m.y} r={markR} />
          ))}
        </g>
      );
    });
    if (sizeBox && sizeBox.width > 0 && sizeBox.height > 0) {
      out.push(
        <GuideBadge
          key="size-badge"
          text={formatSizeBadge(sizeBox)}
          x={sizeBox.left + sizeBox.width / 2}
          y={sizeBox.top + sizeBox.height}
          inv={inv}
          anchor="below"
          fill={SIZE_BADGE_FILL}
        />
      );
    }
    return out;
  }, [guides, sizeBox, inv, stroke, tip, markR, dash]);

  if (!nodes || !guidesMount) return null;

  return createPortal(
    <g data-rcb-smart-guides="1" pointerEvents="none" aria-hidden>
      {nodes}
    </g>,
    guidesMount
  );
}
