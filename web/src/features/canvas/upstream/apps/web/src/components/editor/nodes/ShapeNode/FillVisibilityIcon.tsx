/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/FillVisibilityIcon.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { HiOutlineEye, HiOutlineEyeSlash } from 'react-icons/hi2';

/** Eye / eye-slash for fill layer visibility. */
function FillVisibilityIcon({
  visible,
  className,
}: {
  visible: boolean;
  className?: string;
}) {
  const Icon = visible ? HiOutlineEye : HiOutlineEyeSlash;
  return <Icon className={className} strokeWidth={1.5} aria-hidden />;
}

const MemoizedFillVisibilityIcon = memo(FillVisibilityIcon);
export { MemoizedFillVisibilityIcon as FillVisibilityIcon };
