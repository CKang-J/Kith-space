/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/AdjustToolPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, useState, memo } from 'react';
import {
  HiOutlineSparkles,
  HiOutlineSun,
  HiOutlineSwatch,
} from 'react-icons/hi2';
import { TbContrast, TbDroplet } from 'react-icons/tb';
import { SegmentedControl } from '@recombyn-native/components/base';
import ImageToolPanelShell, {
  PanelFooterActions,
  PanelIconBtn,
  PanelSliderRow,
} from './ImageToolPanelShell';

export type AdjustValues = {
  light: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  temperature: number;
  tint: number;
};

const DEFAULTS: AdjustValues = {
  light: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

const LIGHT_SLIDERS: { key: keyof AdjustValues; label: string }[] = [
  { key: 'light', label: '光线' },
  { key: 'exposure', label: '曝光' },
  { key: 'contrast', label: '对比度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'whites', label: '白色' },
  { key: 'blacks', label: '黑色' },
];

const COLOR_SLIDERS: { key: keyof AdjustValues; label: string }[] = [
  { key: 'saturation', label: '饱和度' },
  { key: 'temperature', label: '色温' },
  { key: 'tint', label: '色调' },
];

export function parseAdjustValues(raw: unknown): AdjustValues {
  let parsed: any = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
  const out = { ...DEFAULTS };
  (Object.keys(DEFAULTS) as (keyof AdjustValues)[]).forEach((k) => {
    const n = Number(parsed[k]);
    if (Number.isFinite(n)) out[k] = Math.max(-100, Math.min(100, Math.round(n)));
  });
  return out;
}

/** Adjust: category tabs + light/color sliders (live preview via onChange). */
function AdjustToolPanel({
  initialValues,
  onCancel,
  onConfirm,
  onChange,
}: {
  initialValues?: Partial<AdjustValues> | unknown;
  onCancel: () => void;
  onConfirm: (opts: AdjustValues) => void;
  /** Live preview while dragging sliders. */
  onChange?: (opts: AdjustValues) => void;
}) {
  const [tab, setTab] = useState<'light' | 'color' | 'detail' | 'effects'>('light');
  const [values, setValues] = useState<AdjustValues>(() =>
    parseAdjustValues(initialValues)
  );

  const rows = useMemo(() => {
    if (tab === 'color') return COLOR_SLIDERS;
    if (tab === 'detail' || tab === 'effects') return LIGHT_SLIDERS.slice(0, 3);
    return LIGHT_SLIDERS;
  }, [tab]);

  const set = (key: keyof AdjustValues, v: number) => {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      onChange?.(next);
      return next;
    });
  };

  const auto = () => {
    const next = {
      ...DEFAULTS,
      light: 8,
      contrast: 12,
      shadows: 10,
      saturation: 6,
    };
    setValues(next);
    onChange?.(next);
  };

  return (
    <ImageToolPanelShell
      title={'调整'}
      width={268}
      onClose={onCancel}
      headerRight={
        <PanelIconBtn title={'自动'} onClick={auto}>
          <HiOutlineSparkles className="h-4 w-4" />
        </PanelIconBtn>
      }
      footer={
        <PanelFooterActions
          onCancel={onCancel}
          onConfirm={() => onConfirm(values)}
          confirmLabel={'应用'}
        />
      }
    >
      <SegmentedControl
        className="mb-2"
        size="sm"
        fullWidth
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { value: 'light' as const, label: <HiOutlineSun className="h-3.5 w-3.5" /> },
          { value: 'color' as const, label: <HiOutlineSwatch className="h-3.5 w-3.5" /> },
          { value: 'detail' as const, label: <TbContrast className="h-3.5 w-3.5" /> },
          { value: 'effects' as const, label: <TbDroplet className="h-3.5 w-3.5" /> },
        ]}
      />

      <div className="max-h-[280px] overflow-y-auto pr-0.5">
        {rows.map((row) => (
          <PanelSliderRow
            key={row.key}
            label={row.label}
            value={values[row.key]}
            min={-100}
            max={100}
            onChange={(v) => set(row.key, v)}
            fillFromZero
          />
        ))}
      </div>
    </ImageToolPanelShell>
  );
}

export default memo(AdjustToolPanel);
