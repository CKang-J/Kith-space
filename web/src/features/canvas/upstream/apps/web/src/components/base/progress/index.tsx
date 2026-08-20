/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/progress/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, type CSSProperties, ReactNode } from 'react';
import { cn } from '@recombyn-native/utils/classnames';
import './style.css';

export type ProgressBarProps = {
  /** 0–100 */
  percent: number;
  /** Ant Design `status="active"` 风格扫光 */
  active?: boolean;
  /** 轨道高度，默认 8（对齐图1 antd Progress） */
  height?: number;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  /** 右侧文案，如 `30% 改了画布`；不传则不显示 */
  format?: ((percent: number) => ReactNode) | false;
};

/**
 * 主站进度条（无 antd）：浅底 + 深色填充，可选扫光动画。
 */
function ProgressBar({
  percent,
  active = true,
  height = 8,
  className,
  trackClassName,
  fillClassName,
  style,
  'aria-label': ariaLabel,
  format,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const showInfo = format !== false && format != null;

  return (
    <div
      className={cn('rcb-progress', showInfo && 'rcb-progress--with-info', className)}
      style={style}
    >
      <div
        className={cn('rcb-progress__track', trackClassName)}
        style={{ height }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={ariaLabel}
      >
        <div
          className={cn(
            'rcb-progress__fill',
            active && pct > 0 && pct < 100 && 'rcb-progress__fill--active',
            fillClassName
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showInfo ? (
        <span className="rcb-progress__info">{format(Math.round(pct))}</span>
      ) : null}
    </div>
  );
}

export default memo(ProgressBar);
