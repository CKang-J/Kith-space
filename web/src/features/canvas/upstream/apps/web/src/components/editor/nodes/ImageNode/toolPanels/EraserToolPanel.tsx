/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/EraserToolPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import Slider from '@recombyn-native/components/base/slider';
import ImageToolPanelShell, {
  PanelFooterActions,
  PanelIconBtn,
} from './ImageToolPanelShell';

/** Eraser: brush-size slider + cancel / use-now (paints on-image). */
function EraserToolPanel({
  brushSize,
  onBrushSizeChange,
  hasStrokes,
  onReset,
  onCancel,
  onConfirm,
  confirmBusy,
}: {
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  hasStrokes: boolean;
  onReset: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmBusy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.eraser')}
      width={240}
      onClose={onCancel}
      headerRight={
        <PanelIconBtn title={'重置'} onClick={onReset}>
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
      footer={
        <PanelFooterActions
          onCancel={onCancel}
          onConfirm={onConfirm}
          confirmLabel={'立即使用'}
          confirmDisabled={!hasStrokes}
          confirmBusy={confirmBusy}
        />
      }
    >
      <div className="flex flex-col items-stretch gap-3 py-3">
        <Slider
          min={16}
          max={400}
          step={1}
          value={brushSize}
          onChange={onBrushSizeChange}
        />
      </div>
    </ImageToolPanelShell>
  );
}

export default memo(EraserToolPanel);
