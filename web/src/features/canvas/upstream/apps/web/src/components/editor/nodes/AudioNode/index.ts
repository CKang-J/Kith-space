/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
export { default as AudioNodeOverlay, getAudioHost } from './AudioNodeOverlay';
export type { AudioGeomOverride, AudioHostApi } from './AudioNodeOverlay';
export { default as AudioWaveform } from './AudioWaveform';
export type { AudioWaveformHandle, AudioWaveformProps } from './AudioWaveform';
export { default as AudioToolbarEditTools } from './AudioToolbarEditTools';
export { default as AudioTrimSessionHost } from './AudioTrimSessionHost';
export { default as AudioSpeedSessionHost } from './AudioSpeedSessionHost';
