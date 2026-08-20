/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/store/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Redux store root.
 *
 * Layout (keep thin):
 * - `index.ts` — configureStore only
 * - `modules/` — Redux slices that are truly cross-tree shared state
 *
 * Do NOT put localStorage helpers, scene/SVG math, or pure formatters here.
 * Those live under `@/utils/*` or `@/components/*` (feature-colocated).
 *
 * Prefer component/local state unless many distant trees must share the same
 * live value (auth session, editor document/selection). Wallet lives in Query.
 */
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './modules/auth';
import editorReducer from './modules/editor';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    editor: editorReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
