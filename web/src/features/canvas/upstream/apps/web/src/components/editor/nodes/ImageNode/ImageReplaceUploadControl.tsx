/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageReplaceUploadControl.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { message } from '@recombyn-native/components/base';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import { uploadImageFile, readFileAsDataUrl, waitForImageReady } from '@recombyn-native/utils/uploadImage';
import {
  measureImageNaturalSize
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { finishImageProcess, patchDocumentNode } from '@recombyn-native/store/modules/editor';

type DispatchLike = (action: unknown) => unknown;

/**
 * Replace an image node's media (upload to COS). Keeps node width; height follows aspect.
 */
export async function replaceImageNodeFromFile(opts: {
  dispatch: DispatchLike;
  nodeId: string;
  keepWidth: number;
  file: File;
  isAlive?: () => boolean;
}): Promise<void> {
  const { dispatch, nodeId, file } = opts;
  const keepWidth = Math.max(1, Math.round(opts.keepWidth));
  const alive = opts.isAlive ?? (() => true);
  if (!file.type.startsWith('image/')) return;

  try {
    const preview = await readFileAsDataUrl(file);
    const naturalPreview = await measureImageNaturalSize(preview);
    const previewH = Math.max(
      1,
      Math.round((keepWidth * naturalPreview.height) / Math.max(1, naturalPreview.width))
    );
    if (!alive()) return;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height: previewH,
          attrs: {
            src: preview,
            processStatus: 'running',
            processKind: 'upload',
            processLabel: '上传中',
            // Local replace — drop AI prompt / multi-gen stack so Quick Edit stays empty.
            genPrompt: '',
            imageVariants: '',
          },
        },
      })
    );

    const uploaded = await uploadImageFile(file);
    const src = uploaded.url;
    if (!alive()) return;

    const remoteReady = await waitForImageReady(src);
    if (!alive()) return;

    let naturalW = Number(uploaded.width) || 0;
    let naturalH = Number(uploaded.height) || 0;
    if (!(naturalW > 0 && naturalH > 0)) {
      const natural = await measureImageNaturalSize(remoteReady ? src : preview);
      naturalW = natural.width;
      naturalH = natural.height;
    }
    const height = Math.max(1, Math.round((keepWidth * naturalH) / Math.max(1, naturalW)));
    const assetKind =
      file.type === 'image/svg+xml' || String(uploaded.mime || '').includes('svg')
        ? 'icon'
        : 'image';

    dispatch(
      finishImageProcess({
        nodeId,
        ...(remoteReady ? { src } : {}),
        attrs: {
          assetKind,
          genPrompt: '',
          imageVariants: '',
          ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
        },
      })
    );
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height,
          attrs: { genPrompt: '', imageVariants: '' },
        },
        skipHistory: true,
      })
    );
  } catch (err: any) {
    if (alive()) {
      dispatch(finishImageProcess({ nodeId }));
      message.error(getHttpErrorMessage(err, '替换图片失败'));
    }
  }
}
