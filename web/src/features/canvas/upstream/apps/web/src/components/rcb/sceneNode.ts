/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/sceneNode.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Canvas document node types (rcb package root — sibling of index).
 * Persistent scene JSON shape; not HTTP product DTOs (`src/models`).
 *
 * Runtime: Zod schemas below for import / hydrate boundaries.
 * Edit path still uses TS + `normalizeDocument` (migrate, not hard-fail).
 */

import { z } from 'zod';
import type { ArtboardFrame } from './frames/types';

/** Known paint keys; string allows legacy / future kinds. */
export type SceneNodeKey =
  | 'entry'
  | 'text'
  | 'shape'
  | 'image'
  | 'video'
  | 'audio'
  | 'lottie'
  | 'svg'
  | (string & {});

/**
 * Node attrs bag — shared keys stay optional; kind-specific fields are free-form.
 * Tighten per-key later (e.g. ShapeAttrs) without moving this file.
 */
export type SceneNodeAttrs = Record<string, unknown>;

/** One scene object in `document.deltaSetLike` (including ROOT). */
export type SceneNode = {
  id: string;
  key: SceneNodeKey;
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;
  attrs: SceneNodeAttrs;
  children: string[];
  /** Display name when set (media / generators). */
  name?: string;
};

/**
 * Loose node input for paint / hit / outline helpers and tests.
 * Prefer `SceneNode` at document boundaries; stubs may omit id/children/x/y.
 */
export type SceneNodeInput = {
  id?: string;
  key?: string;
  x?: number;
  y?: number;
  z?: number;
  width?: number;
  height?: number;
  /** Legacy / outline local boxes sometimes use left/top instead of x/y. */
  left?: number;
  top?: number;
  attrs?: SceneNodeAttrs | null;
  children?: string[];
  name?: string;
  [key: string]: unknown;
};

/** Factory result: new id + node payload. */
export type CreatedSceneNode = {
  id: string;
  node: SceneNode;
};

export type ScenePage = {
  id: string;
  children: string[];
};

/** Flat id → node map (`ROOT` holds top-level child ids). */
export type SceneDeltaSet = Record<string, SceneNode>;

/** Editor document persisted with the project. */
export type SceneDocument = {
  /** Scene origin; often 0 after normalize / import align. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  backgroundFillType?: string;
  backgroundGradient?: unknown;
  backgroundOpacity?: number;
  backgroundImageSrc?: string;
  backgroundImageFit?: string;
  backgroundImageRotate?: number;
  backgroundImageAdjust?: unknown;
  frames?: ArtboardFrame[];
  activeFrameId?: string | null;
  pages?: ScenePage[];
  activePageId?: string;
  deltaSetLike: SceneDeltaSet;
  /** Unified paint order: `frame:id` | `node:id` (bottom → top). */
  stackOrder?: string[];
  [key: string]: unknown;
};

export function isSceneNode(value: unknown): value is SceneNode {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.key === 'string' &&
    typeof n.x === 'number' &&
    typeof n.y === 'number' &&
    typeof n.width === 'number' &&
    typeof n.height === 'number' &&
    n.attrs != null &&
    typeof n.attrs === 'object' &&
    Array.isArray(n.children)
  );
}

/* -------------------------------------------------------------------------- */
/* Zod — boundary validation (import / open / hydrate). Extra keys allowed.   */
/* -------------------------------------------------------------------------- */

/** ROOT entry: children list required; other fields passthrough. */
export const SceneRootNodeSchema = z
  .object({
    children: z.array(z.string(), { required_error: 'ROOT.children is required' }),
  })
  .passthrough();

/**
 * Content node shape for import. Key is open string (image/video/lottie/…).
 * id / attrs / children optional for legacy drafts; normalize fills defaults.
 */
export const SceneNodeSchema = z
  .object({
    id: z.string().optional(),
    key: z.string().min(1, 'Node key is required'),
    x: z.number({ required_error: 'Node x is required' }),
    y: z.number({ required_error: 'Node y is required' }),
    width: z.number({ required_error: 'Node width is required' }),
    height: z.number({ required_error: 'Node height is required' }),
    attrs: z.record(z.unknown()).optional(),
    children: z.array(z.string()).optional(),
    name: z.string().optional(),
    z: z.number().optional(),
  })
  .passthrough();

export const SceneDeltaSetSchema = z
  .object({
    ROOT: SceneRootNodeSchema,
  })
  .catchall(z.union([SceneNodeSchema, z.record(z.unknown())]));

/** Minimal persisted document: size + deltaSetLike.ROOT. */
export const SceneDocumentSchema = z
  .object({
    width: z.number({ required_error: 'width is required' }),
    height: z.number({ required_error: 'height is required' }),
    deltaSetLike: SceneDeltaSetSchema,
  })
  .passthrough();

export type SceneDocumentParsed = z.infer<typeof SceneDocumentSchema>;

export type ValidateSceneDocumentResult =
  | { valid: true; data: SceneDocumentParsed }
  | { valid: false; error: string };

/** Runtime-check unknown JSON as a scene document (does not migrate). */
export function validateSceneDocument(data: unknown): ValidateSceneDocumentResult {
  try {
    const result = SceneDocumentSchema.safeParse(data);
    if (result.success) return { valid: true, data: result.data };
    const errorMessages = result.error.issues.map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    });
    return {
      valid: false,
      error: `Validation failed: ${errorMessages.join('; ')}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/** Parse file text → JSON → Zod scene check. */
export function parseAndValidateSceneJson(rawText: string): ValidateSceneDocumentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, error: 'Invalid JSON format' };
  }
  return validateSceneDocument(parsed);
}

/**
 * Soft hydrate: Zod when possible, otherwise pass through for `normalizeDocument`.
 * Use at external boundaries (cloud / share / collab / import merge) — not edit hot path.
 */
export function coerceSceneDocumentInput(raw: unknown): SceneDocument {
  if (raw == null || typeof raw !== 'object') {
    return raw as SceneDocument;
  }
  const checked = validateSceneDocument(raw);
  return (checked.valid ? checked.data : raw) as SceneDocument;
}
