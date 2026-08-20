/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/MentionAttachPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HiOutlineMusicalNote, HiOutlinePlay } from 'react-icons/hi2';
import type { AssetKind, UserAsset } from '@recombyn-native/models/assets';
import { apiQuery } from '@recombyn-native/service/client';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';
import { cn } from '@recombyn-native/utils/classnames';

export type MentionAttachItem = {
  /** Composer attachment key, skill key, or `asset:{id}`. */
  id: string;
  label: string;
  thumbUrl?: string;
  /** Drives thumb chrome (video cover + play / audio note). */
  mediaKind?: 'image' | 'video' | 'audio';
  /** Optional secondary line (skill whenToUse). */
  hint?: string;
  /** Group label for skill picker / attach+asset sections. */
  group?: string;
};

export const MENTION_ASSET_ID_PREFIX = 'asset:';

type Props = {
  items: MentionAttachItem[];
  query: string;
  onPick: (id: string) => void;
  /**
   * Library assets chosen from `@` (when `includeAssets`).
   * Prefer this over parsing `asset:` ids in `onPick`.
   */
  onPickLibraryAsset?: (asset: UserAsset) => void;
  className?: string;
  /** `attach` = @ attachments (+ optional library assets); `skill` = / skills. */
  variant?: 'attach' | 'skill';
  /** Fetch GET /assets into the `@` list. Default true for attach variant. */
  includeAssets?: boolean;
  /** Limit library kinds (default: image + video + audio). */
  assetKinds?: Array<'image' | 'video' | 'audio'>;
};

function isAllowedAsset(
  a: UserAsset,
  kinds: Array<'image' | 'video' | 'audio'> | undefined
): boolean {
  if (a.kind !== 'image' && a.kind !== 'video' && a.kind !== 'audio') return false;
  if (!kinds?.length) return true;
  return kinds.includes(a.kind);
}

function filterMentionItems(items: MentionAttachItem[], query: string): MentionAttachItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) =>
      it.label.toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      (it.hint || '').toLowerCase().includes(q)
  );
}

function assetMentionLabel(asset: UserAsset, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const prompt = String(asset.prompt || '').trim();
  if (prompt) return prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt;
  if (asset.kind === 'video') return t('me.assetKindVideo', { defaultValue: '视频' });
  if (asset.kind === 'audio') return t('me.assetKindAudio', { defaultValue: '音频' });
  return t('me.assetKindImage', { defaultValue: '图片' });
}

function isLikelyImageThumb(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith('data:image')) return true;
  if (u.startsWith('data:video')) return false;
  return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(u);
}

function MentionRowThumb({
  mediaKind,
  thumbUrl,
}: {
  mediaKind?: 'image' | 'video' | 'audio';
  thumbUrl?: string;
}): ReactNode {
  const thumbClass =
    'relative h-7 w-7 shrink-0 overflow-hidden rounded border border-[var(--line)] bg-[var(--canvas)]';

  if (mediaKind === 'audio') {
    return (
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
        aria-hidden
      >
        <HiOutlineMusicalNote className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
    );
  }

  if (mediaKind === 'video' && thumbUrl) {
    const useImg = isLikelyImageThumb(thumbUrl);
    return (
      <span className={thumbClass} aria-hidden>
        {useImg ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <video
            src={thumbUrl}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <HiOutlinePlay className="h-3 w-3 translate-x-[0.5px] text-white drop-shadow" strokeWidth={2} />
        </span>
      </span>
    );
  }

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded border border-[var(--line)] bg-[var(--canvas)] object-cover"
      />
    );
  }

  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--line)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--muted)]"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6v6H9z" />
      </svg>
    </span>
  );
}

function assetKindHint(
  kind: 'image' | 'video' | 'audio',
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (kind === 'video') return t('me.assetKindVideo', { defaultValue: '视频' });
  if (kind === 'audio') return t('me.assetKindAudio', { defaultValue: '音频' });
  return t('me.assetKindImage', { defaultValue: '图片' });
}

function mentionEmptyKey(opts: {
  variant: 'attach' | 'skill';
  itemsEmpty: boolean;
  mergedEmpty: boolean;
}): string {
  if (opts.variant === 'skill') {
    return opts.itemsEmpty ? 'agent.mentionSkillEmpty' : 'agent.mentionSkillNoMatch';
  }
  return opts.mergedEmpty ? 'agent.mentionAttachEmpty' : 'agent.mentionAttachNoMatch';
}

function libraryAssetToMentionItem(
  a: UserAsset,
  assetsGroup: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): MentionAttachItem {
  const kind = a.kind as 'image' | 'video' | 'audio';
  const url = String(a.url || '').trim();
  const item: MentionAttachItem = {
    id: `${MENTION_ASSET_ID_PREFIX}${a.id}`,
    label: assetMentionLabel(a, t),
    mediaKind: kind,
    hint: assetKindHint(kind, t),
    group: assetsGroup,
  };
  if ((kind === 'image' || kind === 'video') && url) item.thumbUrl = url;
  return item;
}

/**
 * Composer mention picker — `@` attachments (+ library assets) or `/` skills.
 */
function MentionAttachPanel({
  items,
  query,
  onPick,
  onPickLibraryAsset,
  className,
  variant = 'attach',
  includeAssets = variant === 'attach',
  assetKinds,
}: Props): ReactNode {
  const { t } = useTranslation();
  const kindFilter: AssetKind | null =
    assetKinds?.length === 1 ? assetKinds[0]! : null;

  const assetsQuery = useQuery({
    ...apiQuery.assetsListMyAssets.queryOptions({
      input: {
        query: {
          page: 1,
          pageSize: 48,
          ...(kindFilter ? { kind: kindFilter } : {}),
        },
      },
      enabled: variant === 'attach' && includeAssets,
    }),
    staleTime: 30_000,
  });

  const libraryAssets = useMemo(() => {
    const rows = ((assetsQuery.data as { items?: UserAsset[] } | undefined)?.items || []).filter(
      (a) => isAllowedAsset(a, assetKinds)
    );
    return rows;
  }, [assetsQuery.data, assetKinds]);

  const assetsLoading = assetsQuery.isPending && includeAssets && variant === 'attach';
  const assetsRef = useRef<UserAsset[]>([]);
  assetsRef.current = libraryAssets;

  const attachGroup = t('agent.mentionGroupAttachments', { defaultValue: '附件' });
  const assetsGroup = t('agent.mentionGroupAssets', { defaultValue: '资产' });

  const attachItems = items.map((it) => ({
    ...it,
    group: it.group || attachGroup,
  }));

  const showLibraryAssets = variant === 'attach' && includeAssets;
  const assetItems: MentionAttachItem[] = showLibraryAssets
    ? libraryAssets.map((a) => libraryAssetToMentionItem(a, assetsGroup, t))
    : [];

  const merged = [...attachItems, ...assetItems];
  const filtered = filterMentionItems(merged, query);
  const emptyKey = mentionEmptyKey({
    variant,
    itemsEmpty: items.length === 0,
    mergedEmpty: merged.length === 0,
  });

  const handlePick = (id: string) => {
    if (id.startsWith(MENTION_ASSET_ID_PREFIX) && onPickLibraryAsset) {
      const assetId = id.slice(MENTION_ASSET_ID_PREFIX.length);
      const asset = assetsRef.current.find((a) => a.id === assetId);
      if (asset) {
        onPickLibraryAsset(asset);
        return;
      }
    }
    onPick(id);
  };

  const showLoading =
    assetsLoading && variant === 'attach' && includeAssets && !filtered.length;
  const showEmpty = !showLoading && !filtered.length;
  const showList = !showLoading && !showEmpty;

  let lastGroup = '';

  return (
    <div
      className={cn(
        'w-[min(280px,calc(100vw-24px))] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.18)]',
        className
      )}
    >
      <div className="max-h-[min(320px,calc(100vh-160px))] overflow-y-auto p-1">
        {showLoading ? (
          <BrandWordmarkLoader
            label={t('common.loading')}
            className="px-2 py-6"
          />
        ) : null}
        {showEmpty ? (
          <div className="px-2 py-4 text-center text-[12px] text-[var(--muted)]">
            {t(emptyKey)}
          </div>
        ) : null}
        {showList
          ? filtered.map((it) => {
              const showGroup = Boolean(it.group && it.group !== lastGroup);
              if (it.group) lastGroup = it.group;
              const showThumb = variant !== 'skill' || Boolean(it.thumbUrl);
              return (
                <div key={it.id}>
                  {showGroup ? (
                    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      {it.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--canvas)]"
                    onClick={() => handlePick(it.id)}
                  >
                    {showThumb ? (
                      <MentionRowThumb mediaKind={it.mediaKind} thumbUrl={it.thumbUrl} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-[var(--ink)]">
                        {it.label}
                      </span>
                      {it.hint ? (
                        <span className="block truncate text-[10px] text-[var(--muted)]">
                          {it.hint}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

export default memo(MentionAttachPanel);
