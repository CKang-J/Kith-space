/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/AccountNotificationsPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Account settings — announcements & notifications inbox.
 * Content from admin-managed API; read state stays local.
 * Each tab loads its own list via GET /notices?kind=…
 */

import { useMemo, useState, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HiOutlineCheck, HiOutlineMegaphone } from 'react-icons/hi2';
import { SegmentedControl } from '@recombyn-native/components/base';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';
import { apiQuery } from '@recombyn-native/service/client';
import { cn } from '@recombyn-native/utils/classnames';

type NoticeDto = {
  id: string;
  kind: 'announcement' | 'notification' | string;
  title: string;
  body: string;
  createdAt: number;
};

type NoticeTab = 'announcement' | 'notification';

const READ_KEY = 'recombyn.notices.read.v1';

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function formatNoticeTime(
  ts: number,
  lang: string,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 86400000) return t('account.notices.today');
  if (diff < 86400000 * 2) return t('account.notices.yesterday');
  try {
    return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function toMs(ts: number) {
  return ts > 0 && ts < 1e12 ? ts * 1000 : ts;
}

/** Notifications & announcements panel for AccountSettingsDialog. */
function AccountNotificationsPanel(): ReactNode {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<NoticeTab>('announcement');
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());

  const noticesQuery = useQuery({
    ...apiQuery.noticesNoticesList.queryOptions({
      input: { query: { kind: tab } },
    }),
    select: (res) => {
      const raw = res as { items?: NoticeDto[] };
      return (raw.items || [])
        .filter((n) => n.kind === tab)
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    },
  });

  const items = noticesQuery.data || [];
  const loading = noticesQuery.isFetching && !noticesQuery.data;
  const loaded = noticesQuery.isFetched || noticesQuery.isError;

  const unreadInTab = useMemo(
    () => items.reduce((n, item) => (readIds.has(item.id) ? n : n + 1), 0),
    [items, readIds]
  );

  const markAllRead = () => {
    const next = new Set(readIds);
    for (const n of items) next.add(n.id);
    setReadIds(next);
    saveReadIds(next);
  };

  const markRead = (id: string) => {
    if (readIds.has(id)) return;
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    saveReadIds(next);
  };

  const tabs: { id: NoticeTab; label: string }[] = [
    { id: 'announcement', label: t('account.notices.tabAnnouncement') },
    { id: 'notification', label: t('account.notices.tabNotification') },
  ];

  const lang = i18n.resolvedLanguage || i18n.language || 'zh-CN';
  const showLoading = loading && !loaded;

  return (
    <div className="flex min-h-[360px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onChange={(next) => setTab(next as NoticeTab)}
          options={tabs.map((item) => ({
            value: item.id,
            label: item.label,
            badge: item.id === tab ? unreadInTab > 0 : false,
          }))}
        />

        <button
          type="button"
          disabled={unreadInTab <= 0}
          onClick={markAllRead}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] transition',
            unreadInTab > 0
              ? 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]'
              : 'cursor-default text-[var(--muted)] opacity-40'
          )}
        >
          <HiOutlineCheck className="h-3.5 w-3.5" strokeWidth={2} />
          {t('account.notices.markAllRead')}
        </button>
      </div>

      <div className="mt-5 min-h-0 flex-1">
        {showLoading ? (
          <BrandWordmarkLoader
            label={t('common.loading')}
            className="h-[280px]"
          />
        ) : items.length === 0 ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-[var(--muted)]">
            <HiOutlineMegaphone className="h-8 w-8 opacity-40" strokeWidth={1.25} />
            <p className="text-[13px]">{t('account.notices.empty')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const unread = !readIds.has(item.id);
              const createdMs = toMs(item.createdAt);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => markRead(item.id)}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3.5 text-left transition',
                      unread
                        ? 'border-[#f07818]/35 bg-[#f07818]/10'
                        : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--accent-soft)]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {unread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f07818]" />
                          ) : null}
                          <h4 className="truncate text-[14px] font-semibold text-[var(--ink)]">
                            {item.title}
                          </h4>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                          {item.body}
                        </p>
                      </div>
                      <time className="shrink-0 text-[11px] text-[var(--muted)]">
                        {formatNoticeTime(createdMs, lang, t)}
                      </time>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(AccountNotificationsPanel);
