/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/icon/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useMemo } from 'react';
import { cn } from '@recombyn-native/utils/classnames';

/** Sprite id: `{dir}-{file-with-hyphens}` → `#icon-{dir}-{file_with_underscores}` */
export type IconName = string;

interface IconProps {
  name: IconName;
  width?: number | string;
  height?: number | string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders an SVG symbol from the vite svg-icons sprite sheet.
 *
 * @param props - Display options (`name` = `dir-file-with-hyphens`)
 * @returns Inline SVG or null when `name` is empty
 */
export const Icon: React.FC<IconProps> = ({
  name,
  width,
  height,
  color,
  className,
  style,
}) => {
  const symbolId = useMemo(() => {
    if (!name) return '';
    const firstDashIndex = name.indexOf('-');
    if (firstDashIndex === -1) {
      console.warn(`Icon: expected "dir-filename" name, missing directory prefix: ${name}`);
      return `#icon-${name}`;
    }
    const dirName = name.substring(0, firstDashIndex);
    const fileName = name.substring(firstDashIndex + 1).replace(/-/g, '_');
    return `#icon-${dirName}-${fileName}`;
  }, [name]);

  const iconStyle = useMemo(() => {
    const styles: React.CSSProperties = { ...style };

    if (width !== undefined) {
      styles.width = typeof width === 'number' ? `${width}px` : width;
    }
    if (height !== undefined) {
      styles.height = typeof height === 'number' ? `${height}px` : height;
    }
    if (color) {
      styles.color = color;
    }

    return styles;
  }, [width, height, color, style]);

  if (!symbolId) {
    console.warn(`Icon: could not resolve name=${name}`);
    return null;
  }

  return (
    <svg
      className={cn('inline-block shrink-0 text-current', className)}
      style={iconStyle}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <use href={symbolId} xlinkHref={symbolId} width="100%" height="100%" />
    </svg>
  );
};
