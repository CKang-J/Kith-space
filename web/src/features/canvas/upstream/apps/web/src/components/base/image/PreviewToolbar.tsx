/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/image/PreviewToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { memo } from 'react';
import {
  HiOutlineArrowUturnLeft,
  HiOutlineArrowUturnRight,
  HiOutlineArrowsRightLeft,
  HiOutlineArrowsUpDown,
  HiOutlineMinus,
  HiOutlinePlus,
} from 'react-icons/hi2';
import { Button } from '@recombyn-native/components/base/button';

export interface PreviewToolbarProps {
  showCounter?: boolean;
  current?: number;
  total?: number;
  scale?: number;
  onFlipY?: () => void;
  onFlipX?: () => void;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  onZoomOut?: () => void;
  onZoomIn?: () => void;
  /** Override default `fixed bottom-5 …` positioning (e.g. video lightbox). */
  className?: string;
}

const iconCls = 'h-4 w-4 text-white';

/** Lightbox toolbar: flip, rotate, zoom. */
const PreviewToolbar: React.FC<PreviewToolbarProps> = ({
  showCounter = false,
  current = 0,
  total = 0,
  scale = 1,
  onFlipY,
  onFlipX,
  onRotateLeft,
  onRotateRight,
  onZoomOut,
  onZoomIn,
  className,
}) => {
  const minScale = 0.5;
  const maxScale = 5;
  const isZoomOutDisabled = scale <= minScale;
  const isZoomInDisabled = scale >= maxScale;
  return (
    <div
      role="toolbar"
      aria-label="Image preview tools"
      className={
        className ??
        'fixed bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2'
      }
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {showCounter && total > 1 && (
        <div className="rounded-xl bg-[var(--color-background-default-base)]/80 px-3 py-1 text-sm text-white">
          {current + 1} / {total}
        </div>
      )}
      <div className="flex h-[42px] items-center rounded-xl bg-black/50 px-6 backdrop-blur-sm">
        {onFlipY && (
          <Button
            onClick={onFlipY}
            bordered={false}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Flip vertical"
            icon={<HiOutlineArrowsUpDown className={iconCls} aria-hidden />}
          />
        )}
        {onFlipX && (
          <Button
            onClick={onFlipX}
            bordered={false}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Flip horizontal"
            icon={<HiOutlineArrowsRightLeft className={iconCls} aria-hidden />}
          />
        )}
        {onRotateLeft && (
          <Button
            onClick={onRotateLeft}
            bordered={false}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Rotate left"
            icon={<HiOutlineArrowUturnLeft className={iconCls} aria-hidden />}
          />
        )}
        {onRotateRight && (
          <Button
            onClick={onRotateRight}
            bordered={false}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Rotate right"
            icon={<HiOutlineArrowUturnRight className={iconCls} aria-hidden />}
          />
        )}
        {onZoomOut && (
          <Button
            onClick={onZoomOut}
            bordered={false}
            disabled={isZoomOutDisabled}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Zoom out"
            icon={<HiOutlineMinus className={iconCls} aria-hidden />}
          />
        )}
        {onZoomIn && (
          <Button
            onClick={onZoomIn}
            bordered={false}
            disabled={isZoomInDisabled}
            className="!bg-transparent !shadow-none !backdrop-filter-none"
            aria-label="Zoom in"
            icon={<HiOutlinePlus className={iconCls} aria-hidden />}
          />
        )}
      </div>
    </div>
  );
};

export default memo(PreviewToolbar);