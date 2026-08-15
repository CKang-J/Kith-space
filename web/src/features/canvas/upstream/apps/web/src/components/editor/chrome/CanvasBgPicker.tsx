/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/CanvasBgPicker.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { Tooltip } from '@recombyn-native/components/base';
import {
  FillPanelPopover,
  fillPanelPreview,
  type FillPanelValue,
} from '@recombyn-native/components/editor/panels/FillPanel';
import { cn } from '@recombyn-native/utils/classnames';

type Props = {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  /** Clear saved canvas color → follow theme `--canvas`. */
  onReset?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
};

/** Bottom-HUD canvas background — full fill panel (type tabs + solid / gradient / image). */
function CanvasBgPicker({
  value,
  onChange,
  onReset,
  open,
  onOpenChange,
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
}: Props) {
  return (
    <FillPanelPopover
      value={value}
      onChange={onChange}
      onReset={onReset}
      title={'画布背景色'}
      placement="top-start"
      shiftMainAxis={false}
      className="inline-flex"
      open={open}
      onOpenChange={onOpenChange}
      meshSelectedIndex={meshSelectedIndex}
      onMeshSelectedIndexChange={onMeshSelectedIndexChange}
      meshShowGuides={meshShowGuides}
      onMeshShowGuidesChange={onMeshShowGuidesChange}
    >
      {({ open: isOpen, preview }) => (
        <Tooltip tip={'画布背景'} placement="top">
          <span
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
              isOpen ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'
            )}
          >
            <span
              className="box-border h-[15px] w-[15px] shrink-0 overflow-hidden rounded-full border border-[var(--line)]"
              style={{ background: preview || fillPanelPreview(value) }}
            />
          </span>
        </Tooltip>
      )}
    </FillPanelPopover>
  );
}

export default memo(CanvasBgPicker);
