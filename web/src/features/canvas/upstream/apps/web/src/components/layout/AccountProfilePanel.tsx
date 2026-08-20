/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/AccountProfilePanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HiOutlinePencil } from 'react-icons/hi2';
import { apiQuery } from '@recombyn-native/service/client';
import { Button, message } from '@recombyn-native/components/base';
import { UserAvatar } from '@recombyn-native/components/layout/UserAccountPanel';
import { setUser, type AuthUser } from '@recombyn-native/store/modules/auth';
import { cn } from '@recombyn-native/utils/classnames';

const NAME_RE = /^[\p{L}\p{N}\s.'\-_]{1,40}$/u;
const MAX_BIO = 200;
const MAX_AVATAR_MB = 2;

/** Profile + password for AccountSettingsDialog. */
function AccountProfilePanel() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const user = useSelector((s: any) => s.auth.user as AuthUser | null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setBio(user?.bio || '');
    setAvatar(user?.avatar || null);
  }, [user]);

  const onAvatarFile = (file: File | null) => {
    if (!file || saving) return;
    if (!file.type.startsWith('image/')) {
      message.warning(t('me.avatarTypeError'));
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      message.warning(t('me.avatarSizeError', { mb: MAX_AVATAR_MB }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      if (url.startsWith('data:image/')) setAvatar(url);
    };
    reader.readAsDataURL(file);
  };

  const queryClient = useQueryClient();
  const saveProfileMutation = useMutation(
    apiQuery.authAuthPatchProfile.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: apiQuery.authAuthMe.key() });
      },
    })
  );

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning(t('me.nameRequired'));
      return;
    }
    if (trimmed.length > 40 || !NAME_RE.test(trimmed)) {
      message.warning(t('me.nameHint'));
      return;
    }
    if (!user) {
      message.warning(t('me.needLogin'));
      return;
    }
    if (saving) return;
    const nextBio = bio.trim().slice(0, MAX_BIO) || null;
    setSaving(true);
    try {
      const res = (await saveProfileMutation.mutateAsync({
        body: {
          name: trimmed,
          bio: nextBio,
          avatar,
        },
      })) as { user: AuthUser };
      dispatch(
        setUser({
          ...user,
          id: res.user.id || user.id,
          name: res.user.name,
          bio: res.user.bio ?? nextBio,
          avatar: res.user.avatar ?? avatar,
          email: res.user.email || user.email,
          provider: res.user.provider || user.provider,
        })
      );
      message.success(t('me.profileSaved'));
    } catch {
      message.error(t('home.casesLoadFailed'));
    } finally {
      setSaving(false);
    }
  };


  const providerLabel =
    user?.provider === 'google' ? t('account.loginGoogle') : t('account.loginEmail');

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-[var(--account-card)] p-5 ring-1 ring-[var(--line)]">
        <h2 className="mb-4 text-[14px] font-semibold text-[var(--ink)]">{t('account.profileSection')}</h2>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div className="relative w-fit shrink-0">
            <UserAvatar name={name || user?.name} email={user?.email} avatar={avatar} size={64} />
            <button
              type="button"
              aria-label={t('me.changeAvatar')}
              disabled={saving}
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-0.5 -right-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--ink)] shadow ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              <HiOutlinePencil className="h-3.5 w-3.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                onAvatarFile(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-[var(--ink)]">
                {t('me.username')}
                <span className="ml-0.5 text-red-500">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                disabled={saving}
                className={cn(
                  'h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)] outline-none',
                  'focus:border-[var(--ink)] disabled:opacity-60'
                )}
              />
              <span className="mt-1 block text-[11px] text-[var(--muted)]">{t('me.nameHint')}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-[var(--ink)]">{t('me.bio')}</span>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                rows={3}
                disabled={saving}
                className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink)] disabled:opacity-60"
              />
              <span className="mt-1 block text-right text-[11px] text-[var(--muted)]">
                {bio.length}/{MAX_BIO}
              </span>
            </label>
            <div className="flex justify-end">
              <Button
                type="primary"
                loading={saving}
                disabled={saving}
                className="!rounded-xl"
                onClick={() => onSave()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-[var(--account-card)] p-5 ring-1 ring-[var(--line)]">
        <h2 className="mb-3 text-[14px] font-semibold text-[var(--ink)]">{t('account.accountSection')}</h2>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--muted)]">{t('account.email')}</span>
            <span className="font-medium text-[var(--ink)]">{user?.email || '-'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--muted)]">{t('account.loginMethod')}</span>
            <span className="font-medium text-[var(--ink)]">{providerLabel}</span>
          </div>
        </div>
      </section>

    </div>
  );
}

export default memo(AccountProfilePanel);
