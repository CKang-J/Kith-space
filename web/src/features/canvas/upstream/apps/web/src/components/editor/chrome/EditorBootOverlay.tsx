/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/EditorBootOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';
import { cn } from '@recombyn-native/utils/classnames';

type Props = {
  progress: number;
  exiting?: boolean;
};

/** Boot loader only — no skeleton chrome. */
function EditorBootOverlay({ progress, exiting = false }: Props) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={cn(
        'absolute inset-0 z-40 flex items-center justify-center bg-[var(--canvas)] transition-opacity duration-300',
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
      role="progressbar"
      aria-busy="true"
      aria-label={t('editor.initializing')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <BrandWordmarkLoader size="lg" />
    </div>
  );
}

export default memo(EditorBootOverlay);
