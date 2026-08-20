/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/colorPicker/HueSlider.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useState, useCallback, useEffect, useRef, memo } from 'react';

interface HueSliderProps {
  value: number;
  onChange: (hue: number) => void;
  disabled?: boolean;
}

/**
 * Horizontal hue strip (0–360°) with drag support.
 */
export const HueSlider = memo(({ value, onChange, disabled }: HueSliderProps) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateHue = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      onChange(percentage * 360);
    },
    [onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      setIsDragging(true);
      updateHue(e);
    },
    [disabled, updateHue]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => updateHue(e);
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, updateHue]);

  return (
    <div
      ref={sliderRef}
      className='relative h-4 rounded cursor-pointer'
      style={{
        background:
          'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className='absolute top-0 w-1 h-full bg-white border border-gray-300 rounded shadow-sm pointer-events-none'
        style={{ left: `${(value / 360) * 100}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  );
});
