type Point = { x: number; y: number };

const FLY_MS = 640;
const CHIP_W = 112;
const CHIP_H = 28;

let pendingOrigin: Point | null = null;
let pendingLandId: string | null = null;
let stylesReady = false;

export function noteCanvasFlyOrigin(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  pendingOrigin = { x, y };
}

export function takeCanvasFlyOrigin(): Point | null {
  const origin = pendingOrigin;
  pendingOrigin = null;
  return origin;
}

export function noteCanvasFlyLand(landId: string | null): void {
  const id = String(landId || "").trim();
  pendingLandId = id || null;
}

function pointFromEl(el: HTMLElement | null): Point | null {
  if (!el) return null;
  const box = el.getBoundingClientRect();
  if (!(box.width > 8 && box.height > 8)) return null;
  return { x: box.left + Math.min(72, box.width * 0.28), y: box.top + box.height * 0.45 };
}

function resolveLandPoint(landId: string | null): Point {
  if (typeof document === "undefined") {
    return { x: 120, y: 120 };
  }
  const id = String(landId || pendingLandId || "").trim();
  if (id) {
    const scoped = document.querySelector(`[data-fly-land="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
    const point = pointFromEl(scoped instanceof HTMLElement ? scoped : null);
    if (point) return point;
  }
  const fallback = pointFromEl(document.querySelector("[data-fly-land]") as HTMLElement | null);
  if (fallback) return fallback;
  return {
    x: Math.max(120, window.innerWidth - 220),
    y: Math.max(120, window.innerHeight * 0.62),
  };
}

function ensureStyles(): void {
  if (stylesReady || typeof document === "undefined") return;
  if (document.getElementById("kith-canvas-fly-to-chat")) {
    stylesReady = true;
    return;
  }
  const style = document.createElement("style");
  style.id = "kith-canvas-fly-to-chat";
  style.textContent = `
@keyframes kith-fly-chip-arc {
  0% { offset-distance: 0%; opacity: 1; }
  100% { offset-distance: 100%; opacity: 0.15; }
}`;
  document.head.appendChild(style);
  stylesReady = true;
}

function quadraticPath(from: Point, to: Point): string {
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - Math.max(48, Math.abs(to.x - from.x) * 0.22);
  return `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
}

export async function playCanvasFlyToChat(opts: { label?: string; landId?: string | null } = {}): Promise<void> {
  if (typeof document === "undefined") return;
  ensureStyles();
  const from = takeCanvasFlyOrigin() ?? {
    x: Math.max(120, window.innerWidth * 0.45),
    y: Math.max(96, window.innerHeight * 0.38),
  };
  const landId = opts.landId ?? pendingLandId;
  pendingLandId = null;
  const to = resolveLandPoint(landId);
  const label = String(opts.label || "Chat").trim() || "Chat";

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-kith-fly-to-chat", "1");
  el.textContent = label;
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CHIP_W}px`,
    `height:${CHIP_H}px`,
    "z-index:9999",
    "pointer-events:none",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "border-radius:9999px",
    "background:var(--background, #fff)",
    "color:var(--foreground, #111)",
    "box-shadow:0 10px 28px rgba(15,23,42,0.2)",
    "font-size:12px",
    "offset-anchor:center",
    "offset-rotate:0deg",
    `offset-path:path('${quadraticPath(from, to)}')`,
    `animation:kith-fly-chip-arc ${FLY_MS}ms cubic-bezier(0.22, 0.82, 0.2, 1) forwards`,
  ].join(";");
  document.body.appendChild(el);
  await new Promise<void>((resolve) => window.setTimeout(resolve, FLY_MS + 80));
  el.remove();
}
