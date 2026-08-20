/** Pad from the island portal edges when clamping a canvas context menu. */
export const PORTAL_MENU_PAD = 8;

export type PortalRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PortalPoint = {
  left: number;
  top: number;
  viewW: number;
  viewH: number;
};

/** Convert a viewport click into coordinates inside the island portal root. */
export function viewportToPortalPoint(
  clientX: number,
  clientY: number,
  portal: PortalRect,
): PortalPoint {
  return {
    left: clientX - portal.left,
    top: clientY - portal.top,
    viewW: Math.max(1, portal.width),
    viewH: Math.max(1, portal.height),
  };
}

export function clampPortalMenuPos(opts: {
  left: number;
  top: number;
  menuW: number;
  menuH: number;
  viewW: number;
  viewH: number;
  pad?: number;
}): { left: number; top: number } {
  const pad = opts.pad ?? PORTAL_MENU_PAD;
  const viewW = Math.max(1, opts.viewW);
  const viewH = Math.max(1, opts.viewH);
  const h = Math.max(1, opts.menuH);
  const w = Math.min(Math.max(1, opts.menuW), Math.max(1, viewW - pad * 2));
  let left = opts.left;
  let top = opts.top;
  if (left + w > viewW - pad) left = viewW - pad - w;
  if (left < pad) left = pad;
  if (top + h > viewH - pad) top = viewH - pad - h;
  if (top < pad) top = pad;
  return { left, top };
}

export function portalFlyoutFromAnchor(opts: {
  anchor: { left: number; right: number; top: number; bottom: number };
  portal: PortalRect;
  flyoutW: number;
  flyoutH: number;
  pad?: number;
}): { left: number; top: number } {
  const pad = opts.pad ?? PORTAL_MENU_PAD;
  const portalRight = opts.portal.left + opts.portal.width;
  const portalBottom = opts.portal.top + opts.portal.height;
  const preferRight = portalRight - opts.anchor.right >= opts.flyoutW + pad;
  const viewportLeft = preferRight
    ? opts.anchor.right + 4
    : Math.max(opts.portal.left + pad, opts.anchor.left - opts.flyoutW - 4);
  let viewportTop = opts.anchor.top;
  if (viewportTop + opts.flyoutH > portalBottom - pad) {
    viewportTop = Math.max(opts.portal.top + pad, opts.anchor.bottom - opts.flyoutH);
  }
  return {
    left: viewportLeft - opts.portal.left,
    top: viewportTop - opts.portal.top,
  };
}
