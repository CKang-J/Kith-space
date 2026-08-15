/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/colorPicker/SaturationValueArea.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import type { HsvColor, RgbaColor } from './index';

/**
 * Converts HSV (h 0–360, s/v 0–1) to RGBA with alpha 1.
 */
const hsvToRgb = (hsv: HsvColor): RgbaColor => {
  const h = hsv.h / 360;
  const s = hsv.s;
  const v = hsv.v;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0;
  let g = 0;
  let b = 0;

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: 1,
  };
};

interface SaturationValueAreaProps {
  hsv: HsvColor;
  onChange: (s: number, v: number) => void;
  disabled?: boolean;
}

/**
 * 2D pad for saturation (x) and value/brightness (y).
 */
export const SaturationValueArea = memo(({
  hsv,
  onChange,
  disabled,
}: SaturationValueAreaProps) => {
  const areaRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updatePosition = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!areaRef.current) return;
      const rect = areaRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const s = Math.max(0, Math.min(1, x / rect.width));
      const v = Math.max(0, Math.min(1, 1 - y / rect.height));
      onChange(s, v);
    },
    [onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      setIsDragging(true);
      updatePosition(e);
    },
    [disabled, updatePosition]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => updatePosition(e);
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, updatePosition]);

  const rgb = hsvToRgb({ ...hsv, s: 1, v: 1 });
  const bgColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

  return (
    <div
      ref={areaRef}
      className='relative w-full h-28 rounded cursor-crosshair overflow-hidden'
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${bgColor})`,
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className='absolute w-3 h-3 border-2 border-white rounded-full shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-1/2'
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
        }}
      />
    </div>
  );
});
