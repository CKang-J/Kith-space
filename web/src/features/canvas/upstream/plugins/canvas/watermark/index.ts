/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / plugins/canvas/watermark/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Sample canvas plugin — inserts a translucent text watermark at viewport center.
 */
import type { CanvasPluginModule } from '@recombyn-native/plugins/canvas/host';
import manifestJson from './manifest.json';
import iconUrl from './icon.svg';

const manifest = manifestJson as CanvasPluginModule['manifest'];

function tipForLocale(): string {
  const lang =
    typeof navigator !== 'undefined' ? String(navigator.language || '').toLowerCase() : 'en';
  const locales = (manifestJson as { locales?: Record<string, { tip?: string }> }).locales || {};
  if (lang.startsWith('zh')) return locales['zh-CN']?.tip || '插入半透明水印文字';
  return locales.en?.tip || 'Insert a translucent watermark';
}

const watermarkPlugin: CanvasPluginModule = {
  manifest,
  register(api) {
    api.registerToolbarButton({
      id: 'canvas-watermark.insert',
      tip: tipForLocale(),
      order: 220,
      iconSrc: iconUrl,
      onClick(runtime) {
        const state = runtime.getState();
        if (!state.editor?.document) return;
        runtime.placeText({
          text: '© Watermark',
          fontSize: 36,
          opacity: 0.35,
        });
      },
    });
  },
};

export default watermarkPlugin;
