/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/templates/PlazaPublishDialog.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiCheck, HiOutlineSparkles } from 'react-icons/hi2';
import { Button, Dialog, message, SoftGlowSurface } from '@recombyn-native/components/base';
import ProjectCoverCollage from '@recombyn-native/components/home/ProjectCoverCollage';
import { checkPlazaCoverForPublish, coverDocumentHasContent } from '@recombyn-native/utils/plazaCover';
import { normalizeProjectThumbnailUrls } from '@recombyn-native/utils/projectThumb';

function canUseAsImgSrc(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;
  if (raw.startsWith('/')) return true;
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://local');
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

type PlazaPublishFormProps = {
  publishing: boolean;
  projectId?: string;
  projectName: string;
  document?: unknown;
  /** Saved project cover tiles (拼贴) — preferred when list has no live document. */
  coverUrls?: string | string[] | null;
  coverVersion?: number | string | null;
  onCancel: () => void;
  onSubmit: () => Promise<void> | void;
  onSuccessDone?: () => void;
  onPhaseChange?: (phase: 'confirm' | 'success') => void;
};

/**
 * Shared publish-to-plaza body — cover matches 首页 ProjectCoverCollage
 * (rewrite API/base hosts on tab enter; live-raster tiles when URLs missing).
 */
function PlazaPublishForm({
  publishing,
  projectId,
  projectName,
  document,
  coverUrls,
  coverVersion,
  onCancel,
  onSubmit,
  onSuccessDone,
  onPhaseChange,
}: PlazaPublishFormProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'confirm' | 'success'>('confirm');
  const [resolvedUrls, setResolvedUrls] = useState<string[]>([]);
  const [resolvingCover, setResolvingCover] = useState(false);

  const coverCheck = useMemo(() => checkPlazaCoverForPublish(document), [document]);
  const propUrls = useMemo(
    () =>
      normalizeProjectThumbnailUrls(coverUrls, coverVersion).filter(canUseAsImgSrc),
    [coverUrls, coverVersion]
  );
  const hasThumbCollage = resolvedUrls.length > 0;
  const canvasEmpty = !hasThumbCollage && !coverDocumentHasContent(document);
  const canSubmit = (coverCheck.ok || hasThumbCollage) && !canvasEmpty;

  useEffect(() => {
    setPhase('confirm');
    onPhaseChange?.('confirm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Prefer server cover URLs (from /covers). Fallback: live document collage.
  useEffect(() => {
    setResolvedUrls(propUrls);
    setResolvingCover(false);
  }, [propUrls]);

  const goPhase = (next: 'confirm' | 'success') => {
    setPhase(next);
    onPhaseChange?.(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (canvasEmpty) {
      message.warning(t('plaza.emptyCanvas'));
      return;
    }
    try {
      await onSubmit();
      goPhase('success');
    } catch {
      /* error toast handled by caller */
    }
  };

  if (phase === 'success') {
    return (
      <div className="rcb-plaza-thanks relative px-1 pb-2 pt-6 text-center">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-a" />
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-b" />
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-c" />
        </div>

        <div className="relative mx-auto flex h-[72px] w-[72px] items-center justify-center">
          <span className="rcb-plaza-thanks-ring" aria-hidden />
          <span className="rcb-plaza-thanks-badge inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] shadow-[0_10px_28px_rgba(15,23,42,0.18)]">
            <HiCheck className="h-7 w-7" strokeWidth={2.25} />
          </span>
        </div>

        <div className="rcb-plaza-thanks-copy relative mt-5">
          <div className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
            <HiOutlineSparkles className="h-3.5 w-3.5" />
            {t('plaza.thanksEyebrow')}
          </div>
          <h3 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">
            {t('plaza.thanksTitle')}
          </h3>
          <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-[var(--muted)]">
            {t('plaza.thanksBody', { name: projectName })}
          </p>
        </div>

        <div className="relative mt-6 flex justify-center">
          <Button
            size="small"
            type="primary"
            className="!min-w-[96px]"
            onClick={() => (onSuccessDone || onCancel)()}
          >
            {t('plaza.thanksDone')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--canvas)]">
        <div className="aspect-[680/385] w-full overflow-hidden bg-[var(--canvas)]">
          {resolvingCover && !hasThumbCollage ? (
            <SoftGlowSurface className="h-full w-full !rounded-none" seed="plaza-cover" aria-hidden />
          ) : (
            <ProjectCoverCollage
              urls={resolvedUrls}
              version={coverVersion}
              document={document}
              className="!h-full !rounded-none !border-0 !shadow-none"
            />
          )}
        </div>
      </div>

      <p className="mt-3.5 text-[13px] font-medium text-[var(--ink)]">{projectName}</p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
        {t('plaza.publishHint')}
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <Button size="small" type="default" disabled={publishing} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="small"
          type="primary"
          loading={publishing}
          disabled={!canSubmit || resolvingCover}
          onClick={() => void handleSubmit()}
        >
          {t('plaza.submit')}
        </Button>
      </div>
    </div>
  );
}

type PlazaPublishDialogProps = {
  open: boolean;
  publishing: boolean;
  projectId?: string;
  projectName: string;
  document?: unknown;
  coverUrls?: string | string[] | null;
  coverVersion?: number | string | null;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
};

/** Standalone Publish-to-plaza dialog (Projects grid). */
function PlazaPublishDialog({
  open,
  publishing,
  projectId,
  projectName,
  document,
  coverUrls,
  coverVersion,
  onClose,
  onSubmit,
}: PlazaPublishDialogProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'confirm' | 'success'>('confirm');

  useEffect(() => {
    if (open) setPhase('confirm');
  }, [open, projectId]);

  const handleClose = () => {
    if (publishing) return;
    onClose();
  };

  return (
    <Dialog
      show={open}
      onClose={handleClose}
      width={440}
      title={phase === 'confirm' ? t('plaza.publish') : undefined}
      titleClassName="!px-5 !text-[16px] !font-semibold !pb-2"
      className="!overflow-hidden !rounded-2xl !bg-[var(--surface)] !px-0 !pb-4 !pt-5"
      bodyClassName="!px-0 !py-0"
    >
      <div className="px-5 pb-1 pt-1">
        <PlazaPublishForm
          publishing={publishing}
          projectId={projectId}
          projectName={projectName}
          document={document}
          coverUrls={coverUrls}
          coverVersion={coverVersion}
          onCancel={handleClose}
          onSubmit={onSubmit}
          onSuccessDone={handleClose}
          onPhaseChange={setPhase}
        />
      </div>
    </Dialog>
  );
}

export default memo(PlazaPublishDialog);

const MemoizedPlazaPublishForm = memo(PlazaPublishForm);
export { MemoizedPlazaPublishForm as PlazaPublishForm };
