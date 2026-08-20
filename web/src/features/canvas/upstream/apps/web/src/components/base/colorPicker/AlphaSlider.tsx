/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/colorPicker/AlphaSlider.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import type { RgbaColor } from './index';

interface AlphaSliderProps {
  value: number;
  color: RgbaColor;
  onChange: (alpha: number) => void;
  disabled?: boolean;
}

/**
 * Opacity slider over a solid + checkerboard track.
 */
export const AlphaSlider = memo(({ value, color, onChange, disabled }: AlphaSliderProps) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const rgb = `rgb(${color.r}, ${color.g}, ${color.b})`;

  const updateAlpha = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      onChange(percentage);
    },
    [onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      setIsDragging(true);
      updateAlpha(e);
    },
    [disabled, updateAlpha]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => updateAlpha(e);
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, updateAlpha]);

  return (
    <div
      ref={sliderRef}
      className='relative h-4 rounded cursor-pointer overflow-hidden'
      style={{
        backgroundImage: `linear-gradient(to right, transparent, ${rgb}), linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
        backgroundSize: '100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px',
        backgroundPosition: '0 0, 0 0, 0 4px, 4px -4px, -4px 0px',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className='absolute top-0 w-1 h-full bg-white border border-gray-300 rounded shadow-sm pointer-events-none'
        style={{ left: `${value * 100}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  );
});
