/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * @rcb — canvas UI: camera, tools, selection, frames.
 * Prefer `import { … } from '@recombyn-native/components/rcb'`.
 *
 * Layout: `rcbAlignInBox` / `rcbCenterInBox` / `rcbCenterOnPoint` / `rcbFitImageIntoViewport`.
 */

export type { RcbBox, RcbCamera, RcbVec } from './core/types';
export { RCB_DEFAULT_CAMERA } from './core/types';
export {
  RCB_MIN_ZOOM,
  RCB_MAX_ZOOM,
  rcbClampZoom,
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbViewportMetrics,
  rcbClientToStageLocal,
  rcbSceneToScreen,
  rcbScreenToScene,
  rcbClientDeltaToScene,
  rcbResolveViewportEl,
  rcbScreenPxToScene,
  rcbZoomAtPoint,
  rcbFitCamera,
  rcbViewportSceneBounds,
  rcbStepZoom,
} from './core/math';
export { RcbSpatialIndex, boxesIntersect, nodeSceneAabb, type RcbSpatialItem } from './core/spatialIndex';
export {
  rcbAlignInBox,
  rcbCenterInBox,
  rcbCenterOnPoint,
  rcbFitImageIntoViewport,
  rcbLayoutGeneratorPlate,
  generatorEmptyIconSize,
  rcbDefaultPlaceFontSize,
  GENERATOR_EMPTY_STROKE_OUTSET,
  type RcbAlign,
  type RcbBoxLike,
} from './core/layout';

export {
  RcbCameraContext,
  RcbCameraMotionContext,
  RcbOverlayRootContext,
  RcbViewportElContext,
  RcbDevicePixelRatioContext,
  useRcbCamera,
  useRcbCameraMotion,
  useRcbOverlayRoot,
  useRcbViewportEl,
  useRcbDevicePixelRatio,
  useRcbScreenToScene,
  useRcbScreenToolbarStyle,
  RcbOverlayPortal,
} from './camera/context';
export type { RcbCameraMotion } from './camera/context';

export {
  nearestDprMultiple,
  snapCssToDevicePixel,
  toDomPrecision,
  readDevicePixelRatio,
  subscribeDevicePixelRatio,
} from './core/dpr';

export { default as RcbCanvas, zoomAtPoint } from './canvas/RcbCanvas';
export type { RcbCanvasProps } from './canvas/RcbCanvas';
export { default as RcbSvgDefs } from './canvas/RcbSvgDefs';
export { default as RcbSceneOverlayCanvas } from './canvas/RcbSceneOverlayCanvas';
export type { RcbSceneOverlayCanvasHandle } from './canvas/RcbSceneOverlayCanvas';
export { getSvgBoard, setSvgBoard, type SvgBoardHandle } from './canvas/svgBoardRegistry';
export { useSvgBoard } from './canvas/useSvgBoard';

// Per-shape SVG paint hosts (runtime — not document store)
export { default as RcbShapesLayer } from './shapes/RcbShapesLayer';
export { default as RcbShapeHost } from './shapes/RcbShapeHost';
export {
  getShapeHost,
  listShapeHosts,
  registerShapeHost,
  unregisterShapeHost,
  setSharedNodeEls,
  getSharedNodeEls,
  replaceShapePaint,
  type ShapeHostHandle,
  type SceneHostEl,
} from './shapes/shapeHostRegistry';

// Tools
export { default as ShapeDrawFeature } from './tools/ShapeDrawFeature';
export type { ShapeDrawCommit } from './tools/ShapeDrawFeature';
export { default as PenDrawFeature } from './tools/PenDrawFeature';
export { default as PenPathEditFeature } from './tools/PenPathEditFeature';
export { default as PencilDrawFeature } from './tools/PencilDrawFeature';
export type { PencilEraseTarget, PencilEraseStroke } from './tools/PencilDrawFeature';
export { PENCIL_CURSOR, ERASER_CURSOR, PEN_CURSOR, BUCKET_CURSOR } from './tools/PencilDrawFeature';
export { default as BucketFillFeature } from './tools/BucketFillFeature';
export { default as TextPlaceFeature } from './tools/TextPlaceFeature';
export { default as ImagePlaceFeature } from './tools/ImagePlaceFeature';
export * from './tools/penPath';
export * from './tools/pencilBrushes';
export * from './tools/pencilErase';
export { STAMP_TINT_READY_EVENT, getTintedStampSrc } from './tools/stampTint';

// Selection engine + chrome (toolbars/menus under selection/chrome/)
export { default as SelectionFeature } from './selection/SelectionFeature';
export { default as SelectionChrome, WorldSvgFrame, fittedSvgViewport } from './selection/SelectionChrome';
export { default as SelectionContextToolbar } from './selection/chrome/SelectionContextToolbar';
export { default as MultiSelectionToolbar } from './selection/chrome/MultiSelectionToolbar';
export { default as CanvasContextMenu } from './selection/chrome/CanvasContextMenu';
export { default as BrushOverlay } from './selection/chrome/BrushOverlay';
export {
  resizeFromHandle,
  rotateBoxesAround,
  scaleBoxesToUnion,
  unionOfBoxes,
  type ResizeHandle,
} from './selection/resizeGeometry';
export * from './selection/alignGuides';
export * from './selection/shapeBoolean';
export * from './selection/rotateCornerCursor';
export * from './selection/chrome/SelectionToolbarShell';

// Frames
export { default as HtmlArtboardFrame } from './frames/HtmlArtboardFrame';
export { default as FrameDrawFeature } from './frames/FrameDrawFeature';
export { default as FrameMoveFeature } from './frames/FrameMoveFeature';
export type { ArtboardFrame } from './frames/types';

// Document node types (persistent scene JSON)
export type {
  SceneNode,
  SceneNodeInput,
  SceneNodeKey,
  SceneNodeAttrs,
  SceneDocument,
  SceneDocumentParsed,
  SceneDeltaSet,
  ScenePage,
  CreatedSceneNode,
  ValidateSceneDocumentResult,
} from './sceneNode';
export {
  isSceneNode,
  SceneDocumentSchema,
  SceneNodeSchema,
  SceneDeltaSetSchema,
  SceneRootNodeSchema,
  validateSceneDocument,
  parseAndValidateSceneJson,
  coerceSceneDocumentInput,
} from './sceneNode';
export type { SceneNodeRef } from './scene/document/nodeCapabilities';
