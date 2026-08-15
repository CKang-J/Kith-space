/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/AgentRoutePrefsEditor.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Auto routing prefs editor — compact popover (home / dock) + account form.
 */

import { useEffect, useState, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HiChevronLeft, HiChevronRight } from 'react-icons/hi2';
import {
  type ChatModelsResponse,
  type LlmModel,
} from '@recombyn-native/service/chat';
import {
  modelAllowsRouteSlot,
  modelIsImageGenerator,
  isImageKind,
  isVideoKind,
} from '@recombyn-native/components/editor/panels/agent/llmModelMeta';
import { type DesignCatalog } from '@/features/canvas/adapters/recombynStageOneDesign';
import { apiQuery } from '@recombyn-native/service/client';
import { Dropdown, SegmentedControl, Select } from '@recombyn-native/components/base';
import { cn } from '@recombyn-native/utils/classnames';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { getToken } from '@recombyn-native/utils/token';
import {
  customProvidersAsModels,
  hydrateCustomLlmProviders,
} from './customLlmProviders';
import {
  AGENT_ROUTE_POPOVER_PANEL,
  AGENT_ROUTE_SUBMENU_PANEL,
  AUTO_MODEL,
  ModelBrandIcon,
} from './ModelPickerPanel';
import {
  type AgentRoutePrefs,
  type DesignIntensity,
  DESIGN_INTENSITY_VALUES,
  cachePresetRules,
  emptyCustomRoutePrefs,
  getCachedOpenrouterAvailability,
  getCachedPresetRules,
  loadAgentRoutePrefs,
  loadDesignIntensity,
  normalizeDesignIntensity,
  saveAgentRoutePrefs,
  saveDesignIntensity,
  seedCustomLaneFromPrefs,
  warmOpenrouterAvailability,
} from './agentRoutePrefs';

const selectFieldClass =
  'mt-1.5 w-full !h-10 rounded-lg border-0 bg-[var(--account-main)] px-3 pr-8 text-[14px] text-[var(--ink)] ring-1 ring-[var(--line)]';

const NARROW_MQ = '(max-width: 767px)';

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_MQ).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}

/** Nested route flyouts — same dismiss guard as AgentComposerShell model Dropdown. */
const ROUTE_SUBMENU_DISMISS_GUARD =
  '[data-agent-route-submenu], .rcb-agent-route-submenu-popup';

export function splitByokRouteModels(byok: LlmModel[]): { text: LlmModel[]; image: LlmModel[] } {
  return {
    text: byok.filter((m) => m.kind !== 'image' && m.kind !== 'video'),
    image: byok.filter((m) => m.kind === 'image' || modelIsImageGenerator(m)),
  };
}

/** Local desktop → BYOK lanes only; otherwise platform catalog. */
export function routeCatalogFromListModels(res?: {
  models?: LlmModel[] | null;
  imageModels?: LlmModel[] | null;
} | null): { text: LlmModel[]; image: LlmModel[] } {
  if (isDesktopLocal()) return splitByokRouteModels(customProvidersAsModels());
  return {
    text: res?.models || [],
    image: res?.imageModels || [],
  };
}

type RouteCatalogLoadState = 'loading' | 'ready' | 'error';

function routeCatalogLoadState(opts: {
  fromParent: boolean;
  shared: SharedRouteCatalog | null | undefined;
  query: { isLoading: boolean; isFetched: boolean; isError: boolean };
}): RouteCatalogLoadState {
  if (opts.fromParent) {
    if (opts.shared) return 'ready';
    return 'loading';
  }
  if (opts.query.isLoading || !opts.query.isFetched) return 'loading';
  if (opts.query.isError) return 'error';
  return 'ready';
}

function renderRouteLaneSelectLabel(opts: {
  model: LlmModel | null;
  label: string;
  muted: boolean;
}): ReactNode {
  const { model, label, muted } = opts;
  return (
    <span className="flex min-w-0 items-center gap-2 pr-4">
      {model ? <ModelBrandIcon model={model} size={18} className="shrink-0" /> : null}
      <span className={cn('truncate', muted ? 'text-[var(--muted)]' : '')}>{label}</span>
    </span>
  );
}

function compactModelOptionIcon(opt: {
  id: string;
  model?: LlmModel | null;
}): LlmModel | null {
  if (opt.model) return opt.model;
  if (opt.id === 'auto') return AUTO_MODEL;
  return null;
}

function renderCompactModelOptionLabel(opt: {
  id: string;
  label: string;
  model?: LlmModel | null;
}): ReactNode {
  const iconModel = compactModelOptionIcon(opt);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {iconModel ? <ModelBrandIcon model={iconModel} size={18} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">{opt.label}</span>
    </span>
  );
}

function renderRouteLaneSelectOption(
  opt: { value: string | number; label: ReactNode },
  catalogPool: LlmModel[]
): ReactNode {
  const full = catalogPool.find((x) => x.id === opt.value) || null;
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {full ? <ModelBrandIcon model={full} size={18} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--ink)]">
        {opt.label}
      </span>
    </span>
  );
}

function modelOptions(
  models: LlmModel[],
  slot: 'fast' | 'standard' | 'reasoning' | 'vision' | 'image'
): { id: string; label: string }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const m of models) {
    if (!m.id || m.id === 'auto') continue;
    if (!modelAllowsRouteSlot(m, slot)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, label: m.label || m.id });
  }
  return out;
}

function mergeModelCatalogPool(textModels: LlmModel[], imageModels: LlmModel[]): LlmModel[] {
  const byId = new Map<string, LlmModel>();
  for (const m of textModels) {
    if (m?.id) byId.set(m.id, m);
  }
  for (const m of imageModels) {
    if (!m?.id) continue;
    byId.set(m.id, { ...byId.get(m.id), ...m, kind: 'image' });
  }
  return [...byId.values()];
}

type CompactSubmenu = { kind: 'model' } | { kind: 'intensity' } | null;

function submenuSelectedIdOf(
  submenu: CompactSubmenu,
  opts?: { selectedModelId?: string; intensity?: DesignIntensity }
): string {
  if (submenu?.kind === 'model') {
    return String(opts?.selectedModelId || 'auto').trim() || 'auto';
  }
  if (submenu?.kind === 'intensity') {
    return normalizeDesignIntensity(opts?.intensity);
  }
  return '';
}

export type SharedRouteCatalog = {
  text: LlmModel[];
  image: LlmModel[];
  openrouterAvailable: boolean | null;
};

type AgentRoutePrefsEditorProps = {
  /** Popover in agent dock / home — Lovart-style card (not account form). */
  compact?: boolean;
  className?: string;
  /** Fired after prefs are written to localStorage. */
  onChanged?: (prefs: AgentRoutePrefs) => void;
  /**
   * When set (Account Agent tab), parent owns GET /chat/models + BYOK hydrate —
   * do not fetch again. `null` = still loading; object = ready.
   */
  sharedCatalog?: SharedRouteCatalog | null;
  /**
   * Compact popover: selected chat model (`auto` = multi-lane;
   * concrete id = single-model lock).
   */
  selectedModelId?: string;
  /** Compact「单模型」tab: pick a concrete catalog model. */
  onPickModel?: (modelId: string) => void;
  /** When true, only Auto routing is free (member plan). */
  autoOnly?: boolean;
};

/**
 * Auto routing prefs editor — shared by Account settings and Agent model popover.
 * Account: editable Auto lanes only (no Standard / Pro / Max tiers).
 */
function AgentRoutePrefsEditorImpl({
  compact = false,
  className,
  onChanged,
  sharedCatalog,
  selectedModelId,
  onPickModel,
  autoOnly = false,
}: AgentRoutePrefsEditorProps): ReactNode {
  const { t } = useTranslation();
  const desktopLocal = isDesktopLocal();
  const catalogFromParent = sharedCatalog !== undefined;
  const [routePrefs, setRoutePrefs] = useState<AgentRoutePrefs>(() =>
    desktopLocal ? emptyCustomRoutePrefs() : { preset: 'platform' }
  );
  const [designIntensity, setDesignIntensity] = useState<DesignIntensity>(() =>
    loadDesignIntensity()
  );
  const [textModels, setTextModels] = useState<LlmModel[]>([]);
  const [imageModels, setImageModels] = useState<LlmModel[]>([]);
  const [submenu, setSubmenu] = useState<CompactSubmenu>(null);
  const [openrouterAvailable, setOpenrouterAvailable] = useState<boolean | null>(() => getCachedOpenrouterAvailability());
  const narrow = useNarrowViewport();

  useEffect(() => {
    setRoutePrefs(loadAgentRoutePrefs());
    setDesignIntensity(loadDesignIntensity());
  }, []);

  useEffect(() => {
    const syncIntensity = () => setDesignIntensity(loadDesignIntensity());
    window.addEventListener('storage', syncIntensity);
    window.addEventListener('recombyn-design-intensity', syncIntensity);
    return () => {
      window.removeEventListener('storage', syncIntensity);
      window.removeEventListener('recombyn-design-intensity', syncIntensity);
    };
  }, []);

  // Account Agent tab loads catalog once on the parent — skip duplicate design fetch there.
  const designCatalogQuery = useQuery({
    ...apiQuery.designDesignCatalog.queryOptions(),
    staleTime: 60_000,
    enabled: !catalogFromParent,
  });

  const modelsQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
    enabled: !catalogFromParent,
  });

  const byokListQuery = useQuery({
    ...apiQuery.meMeByokList.queryOptions(),
    staleTime: 30_000,
    enabled: !catalogFromParent && desktopLocal && Boolean(getToken()),
  });

  useEffect(() => {
    if (catalogFromParent) return;
    const cat = designCatalogQuery.data as DesignCatalog | undefined;
    if (!cat) return;
    const rules = cat.global_rules || {};
    cachePresetRules(rules);
    setRoutePrefs(loadAgentRoutePrefs(rules));
  }, [catalogFromParent, designCatalogQuery.data]);

  useEffect(() => {
    if (catalogFromParent) {
      if (!sharedCatalog) return;
      setTextModels(sharedCatalog.text);
      setImageModels(sharedCatalog.image);
      setOpenrouterAvailable(sharedCatalog.openrouterAvailable);
      if (sharedCatalog.openrouterAvailable != null) {
        warmOpenrouterAvailability(sharedCatalog.openrouterAvailable);
      }
      setRoutePrefs(loadAgentRoutePrefs(getCachedPresetRules()));
      return;
    }
    if (!modelsQuery.isFetched) return;
    const res = modelsQuery.data as ChatModelsResponse | undefined;
    if (res) {
      const orOk = res.openrouterAvailable !== false;
      warmOpenrouterAvailability(orOk);
      setOpenrouterAvailable(orOk);
      const { text, image } = routeCatalogFromListModels(res);
      setTextModels(text);
      setImageModels(image);
      setRoutePrefs(loadAgentRoutePrefs(getCachedPresetRules()));
    }
  }, [catalogFromParent, sharedCatalog, modelsQuery.data, modelsQuery.isFetched]);

  // Standalone popover on local desktop: refresh BYOK lanes (Account tab parent hydrates).
  useEffect(() => {
    if (!desktopLocal || catalogFromParent) return;
    if (getToken() && !byokListQuery.isFetched) return;
    let cancelled = false;
    async function refreshByokRouteModels() {
      await hydrateCustomLlmProviders();
      if (cancelled) return;
      const { text, image } = splitByokRouteModels(customProvidersAsModels());
      setTextModels(text);
      setImageModels(image);
    }
    refreshByokRouteModels();
    return () => {
      cancelled = true;
    };
  }, [desktopLocal, catalogFromParent, byokListQuery.isFetched, byokListQuery.dataUpdatedAt]);

  const patchRouteField = (key: keyof AgentRoutePrefs, value: string) => {
    setRoutePrefs((prev) => {
      const seeded = seedCustomLaneFromPrefs(prev);
      const next: AgentRoutePrefs = {
        ...seeded,
        preset: 'custom',
        [key]: value,
      };
      saveAgentRoutePrefs(next);
      onChanged?.(next);
      return next;
    });
  };

  const catalogPool = mergeModelCatalogPool(textModels, imageModels);
  const fastOpts = modelOptions(catalogPool, 'fast');
  const standardOpts = modelOptions(catalogPool, 'standard');
  const reasoningOpts = modelOptions(catalogPool, 'reasoning');
  const visionOpts = modelOptions(catalogPool, 'vision');
  const imageOpts = modelOptions(catalogPool, 'image');
  const fieldRows = [
    { key: 'fast' as const, label: t('account.agentRouteFast'), opts: fastOpts },
    { key: 'standard' as const, label: t('account.agentRouteStandard'), opts: standardOpts },
    { key: 'reasoning' as const, label: t('account.agentRouteReasoning'), opts: reasoningOpts },
    { key: 'vision' as const, label: t('account.agentRouteVision'), opts: visionOpts },
    { key: 'image' as const, label: t('account.agentRouteImage'), opts: imageOpts },
  ];

  const singleModelRows = catalogPool.filter(
    (m) => m.id !== 'auto' && !isImageKind(m) && !isVideoKind(m)
  );
  const selectedSingleId = String(selectedModelId || 'auto').trim() || 'auto';

  const laneEmptyLabel = t('account.agentRouteLaneEmpty');

  const modelLabelOf = (id: string | undefined, opts: { id: string; label: string }[]) => {
    const v = String(id || '').trim();
    if (!v) return opts[0]?.label || laneEmptyLabel;
    return opts.find((o) => o.id === v)?.label || v;
  };

  /** Catalog hit only — missing id stays empty (bad data / prefs, do not invent). */
  const modelRefOf = (id: string | undefined, opts: { id: string; label: string }[]) => {
    const v = String(id || '').trim() || opts[0]?.id || '';
    if (!v) return null;
    return catalogPool.find((m) => m.id === v) || null;
  };

  if (compact) {
    let submenuOptions: Array<{ id: string; label: string; model?: LlmModel | null }> = [];
    if (submenu?.kind === 'model') {
      submenuOptions = [
        {
          id: 'auto',
          label: t('agent.routeMultimodalAuto'),
          model: null,
        },
        ...singleModelRows.map((m) => ({
          id: m.id,
          label: m.label || m.id,
          model: m,
        })),
      ];
    }

    const submenuSelectedId = submenuSelectedIdOf(submenu, {
      selectedModelId: selectedSingleId,
      intensity: designIntensity,
    });

    const commitIntensity = (next: DesignIntensity) => {
      const value = normalizeDesignIntensity(next);
      setDesignIntensity(value);
      saveDesignIntensity(value);
      setSubmenu(null);
    };

    const renderSubmenuPanel = (opts?: { embedded?: boolean }) => {
      const embedded = Boolean(opts?.embedded);

      if (submenu?.kind === 'intensity') {
        return (
          <div
            data-agent-route-submenu=""
            className={cn(
              embedded ? 'w-full' : AGENT_ROUTE_SUBMENU_PANEL,
              !embedded && 'rcb-agent-route-submenu-popup'
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {embedded ? (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setSubmenu(null)}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              >
                <HiChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
                {t('agent.routeBack')}
              </button>
            ) : null}
            <div className={cn('flex flex-col gap-0.5', embedded ? 'pt-0.5' : 'p-2')}>
              {DESIGN_INTENSITY_VALUES.map((id) => {
                const active = designIntensity === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => commitIntensity(id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      active
                        ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                        : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {t(`agent.designIntensity.${id}.label`)}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">
                        {t(`agent.designIntensity.${id}.desc`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      }

      if (submenu?.kind === 'model') {
        return (
          <div
            data-agent-route-submenu=""
            className={cn(embedded ? 'w-full' : 'rcb-agent-route-submenu-popup')}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {embedded ? (
              <div className="w-full">
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setSubmenu(null)}
                  className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  <HiChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
                  {t('agent.routeBack')}
                </button>
                <div className="max-h-[min(320px,calc(100vh-220px))] overflow-y-auto px-0.5">
                  {submenuOptions.map((opt) => {
                    const selected = opt.id === submenuSelectedId;
                    const locked = autoOnly && opt.id !== 'auto';
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={locked}
                        title={locked ? t('agent.freeModelLocked') : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                          selected && !locked
                            ? 'bg-[var(--accent-soft)]'
                            : 'hover:bg-[var(--accent-soft)]',
                          locked && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                        )}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (locked) return;
                          if (opt.id === 'auto') {
                            onPickModel?.('auto');
                          } else {
                            onPickModel?.(opt.id);
                          }
                          setSubmenu(null);
                        }}
                      >
                        {renderCompactModelOptionLabel(opt)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={cn(AGENT_ROUTE_SUBMENU_PANEL, 'p-2')}>
                <div className="max-h-[min(320px,calc(100vh-220px))] overflow-y-auto">
                  {submenuOptions.map((opt) => {
                    const selected = opt.id === submenuSelectedId;
                    const locked = autoOnly && opt.id !== 'auto';
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={locked}
                        title={locked ? t('agent.freeModelLocked') : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                          selected && !locked
                            ? 'bg-[var(--accent-soft)]'
                            : 'hover:bg-[var(--accent-soft)]',
                          locked && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                        )}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (locked) return;
                          if (opt.id === 'auto') {
                            onPickModel?.('auto');
                          } else {
                            onPickModel?.(opt.id);
                          }
                          setSubmenu(null);
                        }}
                      >
                        {renderCompactModelOptionLabel(opt)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }

      return null;
    };

    /** Keep focus inside the parent floating menu — remounting rows would blur to body and flicker-close. */
    const keepParentMenuFocus = (e: { preventDefault: () => void }) => {
      e.preventDefault();
    };

    if (narrow && submenu) {
      return (
        <div className={cn(AGENT_ROUTE_POPOVER_PANEL, className)}>
          <div className="px-3 pb-3 pt-4">{renderSubmenuPanel({ embedded: true })}</div>
        </div>
      );
    }

    const routeSideDropdown = (opts: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      trigger: ReactNode;
    }) => (
      <Dropdown
        trigger="click"
        placement="right-start"
        strategy="fixed"
        offset={20}
        items={[]}
        open={opts.open}
        onOpenChange={opts.onOpenChange}
        nestedDismissGuard={ROUTE_SUBMENU_DISMISS_GUARD}
        floatingClassName="z-[80]"
        referenceClassName="block w-full"
        popupRender={() => (
          <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
            {renderSubmenuPanel()}
          </div>
        )}
      >
        {opts.trigger}
      </Dropdown>
    );

    const modelValueLabel =
      selectedSingleId === 'auto'
        ? t('agent.routeMultimodalAuto')
        : singleModelRows.find((m) => m.id === selectedSingleId)?.label ||
          selectedSingleId;
    const intensityShort = t(`agent.designIntensity.${designIntensity}.short`);

    const menuRow = (opts: {
      label: string;
      value: string;
      active: boolean;
      onOpenChange: (open: boolean) => void;
      open: boolean;
    }) =>
      routeSideDropdown({
        open: opts.open,
        onOpenChange: opts.onOpenChange,
        trigger: (
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors',
              opts.active
                ? 'bg-[var(--accent-soft)]'
                : 'hover:bg-[var(--accent-soft)]'
            )}
            onPointerDown={keepParentMenuFocus}
          >
            <span className="shrink-0 text-[13px] font-medium text-[var(--ink)]">
              {opts.label}
            </span>
            <span className="inline-flex min-w-0 max-w-[58%] items-center gap-0.5 text-[12px] text-[var(--muted)]">
              <span className="truncate">{opts.value}</span>
              <HiChevronRight className="h-3.5 w-3.5 shrink-0" />
            </span>
          </button>
        ),
      });

    return (
      <div
        data-agent-route-prefs=""
        className={cn(
          AGENT_ROUTE_POPOVER_PANEL,
          'flex flex-col overflow-hidden',
          className
        )}
      >
        <div className="flex shrink-0 flex-col gap-1 px-3 py-3">
          {menuRow({
            label: t('agent.designModelRow'),
            value: modelValueLabel,
            active: submenu?.kind === 'model',
            open: !narrow && submenu?.kind === 'model',
            onOpenChange: (open) => {
              if (open) setSubmenu({ kind: 'model' });
              else setSubmenu((v) => (v?.kind === 'model' ? null : v));
            },
          })}
          {menuRow({
            label: t('agent.designIntensityRow'),
            value: intensityShort,
            active: submenu?.kind === 'intensity',
            open: !narrow && submenu?.kind === 'intensity',
            onOpenChange: (open) => {
              if (open) setSubmenu({ kind: 'intensity' });
              else setSubmenu((v) => (v?.kind === 'intensity' ? null : v));
            },
          })}
        </div>
      </div>
    );
  }

  const selectCls = selectFieldClass;
  const labelCls = 'text-[13px] font-medium text-[var(--ink)]';
  const lanePrefs = seedCustomLaneFromPrefs(routePrefs);

  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--ink)]">
          {t('agent.designIntensityRow')}
        </h2>
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--muted)]">
          {t('agent.designIntensityTip')}
        </p>
        <SegmentedControl
          size="md"
          radius="full"
          aria-label={t('agent.designIntensityRow')}
          value={designIntensity}
          onChange={(v) => {
            const next = normalizeDesignIntensity(v);
            setDesignIntensity(next);
            saveDesignIntensity(next);
          }}
          options={DESIGN_INTENSITY_VALUES.map((id) => ({
            value: id,
            label: t(`agent.designIntensity.${id}.short`),
          }))}
        />
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
          {t(`agent.designIntensity.${designIntensity}.desc`)}
        </p>
        {(designIntensity === 'high' || designIntensity === 'extreme') && (
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {t('agent.designIntensityCostHint')}
          </p>
        )}
      </div>

      <h2 className="mb-1 text-[15px] font-semibold text-[var(--ink)]">
        {t('account.agentRouteSection')}
      </h2>
      <p className="mb-1 text-[13px] leading-relaxed text-[var(--muted)]">
        {t('account.agentRouteHint')}
      </p>

      {openrouterAvailable === false ? (
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--muted)]">
          {t('account.agentRouteOpenrouterBlocked')}
        </p>
      ) : null}

      <div className="space-y-3 rounded-lg bg-[var(--account-main)] p-3 ring-1 ring-[var(--line)]">
        {fieldRows.map((row) => {
          const laneId = String(lanePrefs[row.key] || '').trim();
          const currentId = laneId || row.opts[0]?.id || '';
          const currentModel = modelRefOf(lanePrefs[row.key], row.opts);
          const emptyLane = !currentId;
          return (
            <label key={row.key} className="block">
              <span className={labelCls}>{row.label}</span>
              <Select
                size="large"
                className={selectCls}
                value={currentId || undefined}
                placeholder={laneEmptyLabel}
                options={row.opts.map((m) => ({ value: m.id, label: m.label }))}
                onChange={(v) => patchRouteField(row.key, String(v))}
                labelRender={() =>
                  renderRouteLaneSelectLabel({
                    model: currentModel,
                    label: modelLabelOf(lanePrefs[row.key], row.opts),
                    muted: emptyLane || !currentModel,
                  })
                }
                optionRender={(opt) => renderRouteLaneSelectOption(opt, catalogPool)}
              />
            </label>
          );
        })}
        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          {t('account.agentRouteCostNote')}
        </p>
      </div>
    </div>
  );
}

const MemoizedAgentRoutePrefsEditor = memo(AgentRoutePrefsEditorImpl);
export { MemoizedAgentRoutePrefsEditor as AgentRoutePrefsEditor };
