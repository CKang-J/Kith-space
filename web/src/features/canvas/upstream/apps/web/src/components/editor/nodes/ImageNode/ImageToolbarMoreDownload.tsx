/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageToolbarMoreDownload.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineArrowsPointingOut,
  HiOutlineEllipsisHorizontal,
  HiOutlineScissors,
} from 'react-icons/hi2';
import { MdOutlineFlip } from 'react-icons/md';
import { Dropdown } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown';
import { cn } from '@recombyn-native/utils/classnames';
import { imageMoreRow, imageToolBtn } from './imageToolbarShared';

export type ImageMoreAction =
  | 'expand'
  | 'adjust'
  | 'crop'
  | 'flipRotate';

/** Image toolbar “More” menu: expand · adjust · crop · flip & rotate. */
function ImageToolbarMoreDownload({
  onAction,
}: {
  onAction: (key: ImageMoreAction) => void;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items: MenuItemType[] = useMemo(
    () => [
      {
        key: 'expand',
        label: imageMoreRow(
          <HiOutlineArrowsPointingOut className="h-4 w-4" />,
          t('editor.imageToolbar.expand')
        ),
      },
      {
        key: 'adjust',
        label: imageMoreRow(
          <HiOutlineAdjustmentsHorizontal className="h-4 w-4" />,
          t('editor.imageToolbar.adjust')
        ),
      },
      {
        key: 'crop',
        label: imageMoreRow(<HiOutlineScissors className="h-4 w-4" />, t('editor.imageToolbar.crop')),
      },
      {
        key: 'flipRotate',
        label: imageMoreRow(
          <MdOutlineFlip className="h-4 w-4" />,
          t('editor.imageToolbar.flipRotate')
        ),
      },
    ],
    [t]
  );

  return (
    <Dropdown
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={8}
      strategy="fixed"
      items={items}
      onClick={(key) => {
        onAction(key as ImageMoreAction);
        setOpen(false);
      }}
      popupClassName="min-w-[11.5rem]"
      floatingClassName="z-[80]"
      referenceClassName="inline-flex"
    >
      <Tooltip tip={t('editor.imageToolbar.more')} placement="top">
        <button
          type="button"
          aria-label={t('editor.imageToolbar.more')}
          className={cn(imageToolBtn, open && 'bg-[var(--accent-soft)]')}
        >
          <HiOutlineEllipsisHorizontal className="h-4 w-4" />
        </button>
      </Tooltip>
    </Dropdown>
  );
}

export default memo(ImageToolbarMoreDownload);
