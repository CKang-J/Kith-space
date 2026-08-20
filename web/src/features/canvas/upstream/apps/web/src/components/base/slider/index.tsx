/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/slider/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { cn } from '@recombyn-native/utils/classnames';
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import type { CSSProperties } from 'react';
import './style.css';

type ISliderProps = {
  className?: string;
  value: number;
  max?: number;
  min?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  vertical?: boolean;
  activeColor?: string;
  inactiveColor?: string;
  trackHeight?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  thumbColor?: string;
  trackBackground?: string;
  /** When range crosses zero, fill from the zero tick toward the thumb instead of from min. */
  fillFromZero?: boolean;
  /** Tooltip above thumb while dragging */
  showValueTooltipOnDrag?: boolean;
  /** Tooltip text formatter */
  formatTooltip?: (value: number) => string;
};

const Slider = ({
  className,
  max = 100,
  min = 0,
  step = 1,
  value,
  disabled,
  onChange,
  vertical,
  activeColor,
  inactiveColor,
  trackHeight,
  thumbWidth,
  thumbHeight,
  thumbColor,
  trackBackground,
  fillFromZero,
  showValueTooltipOnDrag = false,
  formatTooltip,
}: ISliderProps) => {
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const safeValue = Number.isNaN(value) ? min : value;
  const percent = max === min ? 0 : ((safeValue - min) / (max - min)) * 100;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const [tooltipLayout, setTooltipLayout] = useState<{ left: number; arrowLeft: number } | null>(null);

  const active = activeColor ?? 'var(--slider-active)';
  const inactive = inactiveColor ?? 'var(--slider-inactive)';
  const resolvedTrackHeight = typeof trackHeight === 'number' ? trackHeight : 12;
  const resolvedThumbW = typeof thumbWidth === 'number' ? thumbWidth : 16;
  const resolvedThumbH = typeof thumbHeight === 'number' ? thumbHeight : 16;
  const resolvedThumbColor = thumbColor ?? '#ffffff';
  const resolvedThumbWidth = resolvedThumbW;

  const useFillFromZero = Boolean(fillFromZero && min < 0 && max > 0 && !vertical);
  const zeroPercent = max === min ? 0 : ((0 - min) / (max - min)) * 100;

  const backgroundHorizontal = useFillFromZero
    ? safeValue >= 0
      ? `linear-gradient(to right, ${inactive} 0%, ${inactive} ${zeroPercent}%, ${active} ${zeroPercent}%, ${active} ${percent}%, ${inactive} ${percent}%, ${inactive} 100%)`
      : `linear-gradient(to right, ${inactive} 0%, ${inactive} ${percent}%, ${active} ${percent}%, ${active} ${zeroPercent}%, ${inactive} ${zeroPercent}%, ${inactive} 100%)`
    : `linear-gradient(to right, ${active} ${percent}%, ${inactive} ${percent}%)`;

  const computedBackground = vertical
    ? `linear-gradient(to top, ${active} ${percent}%, ${inactive} ${percent}%)`
    : backgroundHorizontal;
  const background = trackBackground ?? computedBackground;

  const inputHeight = Math.max(resolvedTrackHeight, resolvedThumbH, resolvedThumbW);
  const sliderStyle = {
    background,
    '--slider-track-height': `${resolvedTrackHeight}px`,
    '--slider-input-height': `${inputHeight}px`,
    '--slider-thumb-width': `${resolvedThumbW}px`,
    '--slider-thumb-height': `${resolvedThumbH}px`,
    '--slider-thumb-color': resolvedThumbColor,
  } as CSSProperties;

  const tooltipText = useMemo(
    () => (formatTooltip ? formatTooltip(safeValue) : String(safeValue)),
    [formatTooltip, safeValue]
  );
  useEffect(() => {
    if (!showValueTooltipOnDrag || !dragging || disabled || vertical) {
      return;
    }

    const updateLayout = () => {
      const container = containerRef.current;
      const tooltip = tooltipRef.current;
      if (!container || !tooltip) return;

      const containerWidth = container.clientWidth;
      const tooltipWidth = tooltip.offsetWidth;
      const thumbRadius = resolvedThumbWidth / 2;
      const travelWidth = Math.max(0, containerWidth - resolvedThumbWidth);
      const thumbCenterX = thumbRadius + (clampedPercent / 100) * travelWidth;
      const maxLeft = Math.max(0, containerWidth - tooltipWidth);
      const bubbleLeft = Math.min(Math.max(thumbCenterX - tooltipWidth / 2, 0), maxLeft);
      const arrowHalf = 4;
      const arrowLeft = Math.min(
        Math.max(thumbCenterX - bubbleLeft, arrowHalf),
        Math.max(arrowHalf, tooltipWidth - arrowHalf)
      );
      setTooltipLayout({ left: bubbleLeft, arrowLeft });
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, [clampedPercent, disabled, dragging, resolvedThumbWidth, showValueTooltipOnDrag, vertical]);

  useEffect(() => {
    if (!dragging) {
      setTooltipLayout(null);
    }
  }, [dragging]);

  return (
    <div
      className={cn('rcb-slider h-full w-full', !vertical && 'flex items-center')}
      ref={containerRef}
    >
      {showValueTooltipOnDrag && dragging && !disabled && !vertical && (
        <div
          ref={tooltipRef}
          className="rcb-slider__tooltip"
          style={tooltipLayout ? { left: `${tooltipLayout.left}px`, transform: 'translateX(0)' } : undefined}
        >
          {tooltipText}
          <span
            className="rcb-slider__tooltip-arrow"
            style={tooltipLayout ? { left: `${tooltipLayout.arrowLeft}px` } : undefined}
          />
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseDown={() => setDragging(true)}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchStart={() => setDragging(true)}
        onTouchEnd={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        className={cn(
          'rcb-slider__input',
          vertical && 'rcb-slider__input--vertical',
          className
        )}
        style={sliderStyle}
      />
    </div>
  );
};

export default memo(Slider);