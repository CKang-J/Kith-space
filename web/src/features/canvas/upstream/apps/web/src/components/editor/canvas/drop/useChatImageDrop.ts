/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/drop/useChatImageDrop.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, type RefObject } from 'react';
import { useDispatch } from 'react-redux';
import {
  measureImageNaturalSize,
  parseLottieAnimationData
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { sceneToDocumentCoords } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import { rcbCenterOnPoint, type RcbCamera } from '@recombyn-native/components/rcb';
import {
  beginNodeUpload,
  finishNodeUpload,
  isUploadAbortError,
  toDisplayMediaUrl,
  uploadImageFromSrc,
  waitForImageReady,
} from '@recombyn-native/utils/uploadImage';
import {
  dataTransferHasChatImage,
  dataTransferHasMediaAsset,
  readChatImageDragUrl,
  readMediaAssetDragPayload,
  clearMediaAssetDragData,
  type MediaAssetDragPayload,
} from '@recombyn-native/utils/chatImageDrag';
import { message } from '@recombyn-native/components/base';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import store from '@recombyn-native/store';
import {
  failImageProcess,
  finishImageProcess,
  placeMediaAsset,
  startImageUploadPlaceholder,
} from '@recombyn-native/store/modules/editor';
import { pointerToWorld, type ArtboardRect } from '../pointerToWorld';

type UseChatImageDropArgs = {
  readOnly: boolean;
  camera: RcbCamera;
  artboard?: ArtboardRect;
  viewportEl: HTMLElement | null;
  stageEl: HTMLElement | null;
  paperEl: HTMLElement | null;
  documentRef: RefObject<any>;
  imageSizeForViewport: (natural: { width: number; height: number }) => {
    width: number;
    height: number;
  };
  finishToSelect: () => void;
};

async function resolveAssetPlaceSize(
  payload: MediaAssetDragPayload,
  imageSizeForViewport: (natural: { width: number; height: number }) => {
    width: number;
    height: number;
  }
): Promise<{ width: number; height: number }> {
  const kind = payload.kind;
  if (kind === 'audio') {
    const width = Math.max(1, Math.round(Number(payload.width) || 360));
    const height = Math.max(140, Math.round(Number(payload.height) || 200));
    return { width, height };
  }
  const ow = Math.max(0, Math.round(Number(payload.width) || 0));
  const oh = Math.max(0, Math.round(Number(payload.height) || 0));
  if (ow > 0 && oh > 0) {
    return imageSizeForViewport({ width: ow, height: oh });
  }
  if (kind === 'video') {
    return imageSizeForViewport({ width: 640, height: 360 });
  }
  if (kind === 'lottie') {
    return imageSizeForViewport({ width: 200, height: 200 });
  }
  const natural = await measureImageNaturalSize(payload.src);
  return imageSizeForViewport(natural);
}

/** Resolve a displayable canvas src. Prefer inline data: (list thumbs) — no extra fetch. */
async function hydrateAssetSrcForCanvas(
  payload: MediaAssetDragPayload
): Promise<{ src: string; uploadKey?: string; animationData?: Record<string, unknown> }> {
  const src = String(payload.src || '').trim();
  const uploadKey = String(payload.uploadKey || '').trim() || undefined;
  if (!src) return { src, uploadKey };

  if (payload.kind === 'lottie') {
    const fromList = parseLottieAnimationData(payload.animationData);
    if (fromList) return { src, uploadKey, animationData: fromList };
    throw new Error('lottie asset missing animationData');
  }

  // Place with the URL we got — no auth-fetch / blob round-trip.
  return { src: toDisplayMediaUrl(src, uploadKey), uploadKey };
}

/** Drag chat gallery images / Assets dock media onto the canvas. */
export function useChatImageDrop(args: UseChatImageDropArgs) {
  const {
    readOnly,
    camera,
    artboard,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    imageSizeForViewport,
    finishToSelect,
  } = args;
  const dispatch = useDispatch();

  useEffect(() => {
    const hitEl = stageEl || paperEl;
    if (readOnly || !hitEl) return undefined;

    const onDragOver = (e: DragEvent) => {
      if (
        !dataTransferHasMediaAsset(e.dataTransfer) &&
        !dataTransferHasChatImage(e.dataTransfer)
      ) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const placeHostedAsset = async (
      payload: MediaAssetDragPayload,
      clientX: number,
      clientY: number
    ) => {
      const hydrated = await hydrateAssetSrcForCanvas(payload);
      const placePayload = {
        ...payload,
        src: hydrated.src,
        uploadKey: hydrated.uploadKey,
      };
      let width: number;
      let height: number;
      if (payload.kind === 'lottie' && hydrated.animationData) {
        const aw = Math.max(1, Math.round(Number(hydrated.animationData.w) || 0));
        const ah = Math.max(1, Math.round(Number(hydrated.animationData.h) || 0));
        if (aw > 0 && ah > 0) {
          ({ width, height } = imageSizeForViewport({ width: aw, height: ah }));
        } else {
          ({ width, height } = await resolveAssetPlaceSize(placePayload, imageSizeForViewport));
        }
      } else {
        ({ width, height } = await resolveAssetPlaceSize(
          placePayload,
          imageSizeForViewport
        ));
      }
      const world = pointerToWorld(
        camera,
        { viewportEl, stageEl, paperEl, artboard },
        clientX,
        clientY
      );
      const placed = rcbCenterOnPoint(world, { width, height });
      const latest = documentRef.current;
      if (!latest) return;
      const origin = sceneToDocumentCoords(latest, placed.left, placed.top);
      const prompt = String(placePayload.prompt || '').trim();
      dispatch(
        placeMediaAsset({
          kind: placePayload.kind,
          src: placePayload.src,
          uploadKey: placePayload.uploadKey || undefined,
          width,
          height,
          prompt: prompt || undefined,
          name:
            String(placePayload.name || '').trim() ||
            prompt.slice(0, 40) ||
            undefined,
          duration: placePayload.duration,
          x: origin.x,
          y: origin.y,
          ...(hydrated.animationData
            ? { animationData: hydrated.animationData }
            : {}),
        })
      );
      finishToSelect();
    };

    const placeChatImage = async (url: string, clientX: number, clientY: number) => {
      const natural = await measureImageNaturalSize(url);
      const { width, height } = imageSizeForViewport(natural);
      const world = pointerToWorld(
        camera,
        { viewportEl, stageEl, paperEl, artboard },
        clientX,
        clientY
      );
      const placed = rcbCenterOnPoint(world, { width, height });
      const latest = documentRef.current;
      if (!latest) return;
      const origin = sceneToDocumentCoords(latest, placed.left, placed.top);
      dispatch(
        startImageUploadPlaceholder({
          src: url,
          width,
          height,
          x: origin.x,
          y: origin.y,
          label: '上传中',
          name: 'Image',
        })
      );
      finishToSelect();
      const spawnedId = String(
        (store.getState() as any).editor?.pendingImageProcessId || ''
      );
      const signal = spawnedId ? beginNodeUpload(spawnedId) : undefined;
      try {
        const uploaded = await uploadImageFromSrc(url, 'chat-image.png', { signal });
        if (signal?.aborted) return;
        const remoteReady = await waitForImageReady(uploaded.url, { signal });
        if (signal?.aborted) return;
        dispatch(
          finishImageProcess({
            nodeId: spawnedId || undefined,
            ...(remoteReady ? { src: uploaded.url } : {}),
            attrs: uploaded.key ? { uploadKey: uploaded.key } : undefined,
          })
        );
      } finally {
        finishNodeUpload(spawnedId);
      }
    };

    const onDrop = async (e: DragEvent) => {
      const asset = readMediaAssetDragPayload(e.dataTransfer);
      if (asset) {
        e.preventDefault();
        e.stopPropagation();
        clearMediaAssetDragData();
        try {
          await placeHostedAsset(asset, e.clientX, e.clientY);
        } catch (err: any) {
          message.error(getHttpErrorMessage(err, '放置失败'));
        }
        return;
      }

      const url = readChatImageDragUrl(e.dataTransfer);
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await placeChatImage(url, e.clientX, e.clientY);
      } catch (err: any) {
        if (isUploadAbortError(err)) return;
        dispatch(failImageProcess({}));
        message.error(getHttpErrorMessage(err, '图片上传失败'));
      }
    };

    hitEl.addEventListener('dragover', onDragOver);
    hitEl.addEventListener('drop', onDrop);
    return () => {
      hitEl.removeEventListener('dragover', onDragOver);
      hitEl.removeEventListener('drop', onDrop);
    };
  }, [
    artboard,
    camera,
    dispatch,
    documentRef,
    finishToSelect,
    imageSizeForViewport,
    paperEl,
    readOnly,
    stageEl,
    viewportEl,
  ]);
}
