/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/MultiAngleToolPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import { message, SegmentedControl } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { cn } from '@recombyn-native/utils/classnames';
import AngleEditorScene, {
  type AngleCubeScale,
  type AngleEditorMode,
} from './AngleEditorScene';
import ImageToolPanelShell, {
  IMAGE_TOOL_TOKEN_COST,
  PanelConfirmCost,
  PanelIconBtn,
  PanelSliderRow,
} from './ImageToolPanelShell';

const ANGLE_CUBE_SCALES: AngleCubeScale[] = [1, 5, 10];

function scaleIndexToValue(i: number): AngleCubeScale {
  return ANGLE_CUBE_SCALES[i] ?? 5;
}

function scaleValueToIndex(s: AngleCubeScale): number {
  const idx = ANGLE_CUBE_SCALES.indexOf(s);
  return idx >= 0 ? idx : 1;
}

const ANGLE_PRESET_KEYS = [
  { key: 'front', rotate: 0, tilt: 0 },
  { key: 'side', rotate: 90, tilt: 0 },
  { key: 'reverse', rotate: -90, tilt: 0 },
  { key: 'threeQuarter', rotate: 45, tilt: 0 },
  { key: 'top', rotate: 0, tilt: 60 },
  { key: 'low', rotate: 0, tilt: -60 },
] as const;

const ROTATE_MIN = -90;
const ROTATE_MAX = 90;
const TILT_MIN = -60;
const TILT_MAX = 60;

/** Left preview column width; height stretches with the right column + CTA. */
const PREVIEW_WIDTH = 240;

const confirmBtnClass =
  'inline-flex h-7 w-full shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[12px] font-medium leading-none transition-colors bg-[var(--ink)] text-[var(--on-brand)] hover:opacity-90 disabled:bg-[var(--line)] disabled:text-[var(--muted)] disabled:opacity-80';

const clampInt = (v: number, min: number, max: number) =>
  Math.round(Math.max(min, Math.min(max, v)));

/** Multi-angle tool: left preview + right controls. */
function MultiAngleToolPanel({
  imageSrc,
  onCancel,
  onConfirm,
}: {
  imageSrc?: string;
  onCancel: () => void;
  onConfirm: (opts: { rotate: number; tilt: number; zoom: number; mode: AngleEditorMode }) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AngleEditorMode>('camera');
  const [rotate, setRotate] = useState(45);
  const [tilt, setTilt] = useState(0);
  const [scale, setScale] = useState<AngleCubeScale>(5);

  const setRotateInt = (v: number) => setRotate(clampInt(v, ROTATE_MIN, ROTATE_MAX));
  const setTiltInt = (v: number) => setTilt(clampInt(v, TILT_MIN, TILT_MAX));

  const reset = () => {
    setRotate(0);
    setTilt(0);
    setScale(5);
  };

  const angleLabel = (key: (typeof ANGLE_PRESET_KEYS)[number]['key']) => {
    const map = {
      front: 'editor.imageToolbar.angleFront',
      side: 'editor.imageToolbar.angleSide',
      reverse: 'editor.imageToolbar.angleReverse',
      threeQuarter: 'editor.imageToolbar.angleThreeQuarter',
      top: 'editor.imageToolbar.angleTop',
      low: 'editor.imageToolbar.angleLow',
    } as const;
    return t(map[key]);
  };

  const applyPreset = (preset: (typeof ANGLE_PRESET_KEYS)[number]) => {
    setRotateInt(preset.rotate);
    setTiltInt(preset.tilt);
  };

  const activePresetKey =
    ANGLE_PRESET_KEYS.find((p) => p.rotate === rotate && p.tilt === tilt)?.key ?? null;

  const scaleLabel =
    scale === 1
      ? t('editor.imageToolbar.distanceNear')
      : scale === 10
        ? t('editor.imageToolbar.distanceFar')
        : t('editor.imageToolbar.distanceMid');

  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.multiAngle')}
      width={PREVIEW_WIDTH + 220 + 32}
      onClose={onCancel}
      headerRight={
        <PanelIconBtn title={t('editor.imageToolbar.reset')} onClick={reset}>
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
    >
      <div className="flex items-stretch gap-2.5">
        {/* Left — preview stretches to align with Use now */}
        <div
          className="relative min-h-[280px] shrink-0 self-stretch overflow-hidden rounded bg-[var(--canvas)] ring-1 ring-[var(--line)]"
          style={{ width: PREVIEW_WIDTH }}
        >
          <AngleEditorScene
            className="h-full w-full"
            mode={tab}
            rotate={rotate}
            tilt={tilt}
            cubeScale={scale}
            imageSrc={imageSrc}
            onRotateChange={setRotateInt}
            onTiltChange={setTiltInt}
          />
        </div>

        {/* Right — mode, presets, fine-tune + CTA */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <SegmentedControl
              className="shrink-0"
              size="sm"
              fullWidth
              value={tab}
              onChange={(next) => setTab(next)}
              options={[
                { value: 'skybox' as const, label: t('editor.imageToolbar.skybox') },
                { value: 'camera' as const, label: t('editor.imageToolbar.camera') },
              ]}
            />

            <div className="min-h-0 flex-1">
              <div className="mb-2.5 text-[12px] text-[var(--muted)]">
                {t('editor.imageToolbar.commonAngles')}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {ANGLE_PRESET_KEYS.map((preset) => {
                  const active = activePresetKey === preset.key;
                  const label = angleLabel(preset.key);
                  const tip = `${label}  ${preset.rotate}° / ${preset.tilt}°`;
                  return (
                    <Tooltip key={preset.key} tip={tip} placement="top">
                      <button
                        type="button"
                        aria-label={tip}
                        onClick={() => applyPreset(preset)}
                        className={cn(
                          'h-8 w-full rounded-xl px-2 text-[12px] font-medium transition-colors',
                          active
                            ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                            : 'bg-[var(--accent-soft)] text-[var(--ink)] hover:bg-[var(--line)]'
                        )}
                      >
                        {label}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            <div className="mt-auto flex shrink-0 flex-col gap-2.5">
              <PanelSliderRow
                className="py-0"
                label={t('editor.imageToolbar.rotate')}
                value={rotate}
                min={ROTATE_MIN}
                max={ROTATE_MAX}
                step={1}
                display={`${rotate}°`}
                onChange={setRotateInt}
                fillFromZero
              />
              <PanelSliderRow
                className="py-0"
                label={t('editor.imageToolbar.tilt')}
                value={tilt}
                min={TILT_MIN}
                max={TILT_MAX}
                step={1}
                display={`${tilt}°`}
                onChange={setTiltInt}
                fillFromZero
              />
              <PanelSliderRow
                className="py-0"
                label={t('editor.imageToolbar.zoom')}
                value={scaleValueToIndex(scale)}
                min={0}
                max={2}
                step={1}
                display={scaleLabel}
                onChange={(v) => setScale(scaleIndexToValue(v))}
              />
            </div>
          </div>

          <button
            type="button"
            className={cn(confirmBtnClass, 'mt-[10px]')}
            onClick={() => {
              try {
                onConfirm({
                  rotate,
                  tilt,
                  zoom: scale,
                  mode: tab,
                });
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : '';
                message.error(
                  /could not be cloned|DataCloneError/i.test(msg)
                    ? '无法创建处理节点，请刷新后重试'
                    : msg || '多角度失败'
                );
              }
            }}
          >
            <span className="truncate">{t('editor.imageToolbar.useNow')}</span>
            <PanelConfirmCost amount={IMAGE_TOOL_TOKEN_COST.multiAngle} />
          </button>
        </div>
      </div>
    </ImageToolPanelShell>
  );
}

export default memo(MultiAngleToolPanel);
