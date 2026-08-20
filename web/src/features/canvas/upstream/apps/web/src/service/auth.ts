/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/service/auth.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Auth API — Google Sign-In + email verification-code login + session.
 */

import { apiClient, apiQuery } from '@recombyn-native/service/client';

export type AuthUserDto = {
  id?: string;
  email: string;
  name: string;
  avatar?: string | null;
  provider: 'email' | 'google';
  bio?: string | null;
  /** Present when signed in; admin can use main-site training mode. */
  role?: 'user' | 'admin' | string;
};

/** Login with Google — full-page redirect auth-code, or GIS ID token. */
export const loginGoogle = (payload: {
  code?: string;
  credential?: string;
  /** Must match the redirect_uri used in the authorize request. */
  redirectUri?: string;
}) =>
  apiClient.authAuthGoogle({ body: payload }) as Promise<{
    user: AuthUserDto;
    token: string;
  }>;

/** Send 6-digit email verification code via Tencent SES. */
export const sendEmailCode = (data: { email: string; captchaToken?: string }) =>
  apiClient.authEmailSendCode({ body: data }) as Promise<{
    ok: boolean;
    expiresIn: number;
    mode?: string;
  }>;

/** Consume /activate/:id one-time link → session (legacy magic-link mails). */
export const activateEmailLink = (data: { id: string }) =>
  apiClient.authEmailActivate({ body: data }) as Promise<{
    user: AuthUserDto;
    token: string;
  }>;

/** Verify 6-digit code → session. */
export const verifyEmailCode = (data: {
  email: string;
  code: string;
  captchaToken?: string;
}) =>
  apiClient.authEmailVerifyCode({ body: data }) as Promise<{
    user: AuthUserDto;
    token: string;
  }>;

export type SliderCaptchaChallenge = {
  captchaId: string;
  bg: string;
  piece: string;
  pieceY: number;
  bgWidth: number;
  bgHeight: number;
  pieceSize: number;
  pieceWidth?: number;
  pieceHeight?: number;
  expiresIn: number;
};

/** Create a slider captcha challenge (self-hosted). */
export const createSliderCaptcha = () =>
  apiClient.authCaptchaCreate() as Promise<SliderCaptchaChallenge>;

/** Verify slider position → one-time captchaToken for login. */
export const verifySliderCaptcha = (payload: {
  captchaId: string;
  x: number;
  email: string;
  trajectory?: Array<{ t: number; x: number }>;
}) =>
  apiClient.authCaptchaVerify({ body: payload }) as Promise<{
    captchaToken: string;
    beatPercent?: number;
    expiresIn: number;
  }>;

/** Public auth/feature flags (no login). */
export const fetchAuthConfig = () =>
  apiClient.authAuthConfig() as Promise<{
    googleEnabled: boolean;
    googleClientId?: string | null;
    emailEnabled: boolean;
    billingEnabled?: boolean;
  }>;

/** Get the current authenticated user (+ credit balance). */
export const getMe = () =>
  apiClient.authAuthMe() as Promise<{ user: AuthUserDto; tokens?: number }>;

/** Update name / bio / avatar for the signed-in user. */
export const updateProfile = (payload: {
  name?: string;
  bio?: string | null;
  avatar?: string | null;
}) =>
  apiQuery.authAuthPatchProfile.call({ body: payload }) as Promise<{ user: AuthUserDto }>;

/** Logout and invalidate the session. */
export const logout = () =>
  apiClient.authAuthLogout() as Promise<{ message: string }>;

/**
 * Desktop-local auto login (OS user → local SQLite account).
 * Only when API has DESKTOP_LOCAL_AUTO_LOGIN=true (Tauri local sidecar).
 */
export const loginDesktopLocal = (payload?: { username?: string }) =>
  apiClient.authDesktopLocalLogin({
    body: payload || {},
  }) as Promise<{ user: AuthUserDto; token: string }>;
