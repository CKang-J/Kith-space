/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoReplaceCornerButton.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { message } from '@recombyn-native/components/base';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import { uploadImageFile, readFileAsDataUrl } from '@recombyn-native/utils/uploadImage';
import {
  captureVideoPosterFrame,
  measureVideoNaturalSize
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { finishImageProcess, patchDocumentNode } from '@recombyn-native/store/modules/editor';

type DispatchLike = (action: unknown) => unknown;

/**
 * Replace a video node's media (upload to COS). Keeps node width; height follows aspect.
 * Clears prior crop / trim for the new source.
 */
export async function replaceVideoNodeFromFile(opts: {
  dispatch: DispatchLike;
  nodeId: string;
  keepWidth: number;
  file: File;
  isAlive?: () => boolean;
}): Promise<void> {
  const { dispatch, nodeId, file } = opts;
  const keepWidth = Math.max(1, Math.round(opts.keepWidth));
  const alive = opts.isAlive ?? (() => true);
  if (!file.type.startsWith('video/')) return;

  try {
    const preview = await readFileAsDataUrl(file);
    const naturalPreview = await measureVideoNaturalSize(preview);
    const previewH = Math.max(
      1,
      Math.round((keepWidth * naturalPreview.height) / Math.max(1, naturalPreview.width))
    );
    let previewPoster = '';
    try {
      previewPoster = await captureVideoPosterFrame(preview);
    } catch {
      /* optional */
    }
    if (!alive()) return;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height: previewH,
          attrs: {
            src: preview,
            ...(previewPoster ? { poster: previewPoster } : {}),
            processStatus: 'running',
            processKind: 'upload',
            processLabel: '上传中',
            // Local replace — drop AI prompt so Quick Edit stays empty.
            genPrompt: '',
            cropX: 0,
            cropY: 0,
            cropW: 1,
            cropH: 1,
            trimStart: '',
            trimEnd: '',
          },
        },
      })
    );

    const uploaded = await uploadImageFile(file);
    const src = uploaded.url;
    if (!alive()) return;

    let naturalW = Number(uploaded.width) || 0;
    let naturalH = Number(uploaded.height) || 0;
    if (!(naturalW > 0 && naturalH > 0)) {
      const natural = await measureVideoNaturalSize(src);
      naturalW = natural.width;
      naturalH = natural.height;
    }
    const height = Math.max(1, Math.round((keepWidth * naturalH) / Math.max(1, naturalW)));

    let poster = previewPoster;
    if (!poster) {
      try {
        poster = await captureVideoPosterFrame(src);
      } catch {
        /* optional */
      }
    }

    dispatch(
      finishImageProcess({
        nodeId,
        src,
        attrs: {
          assetKind: 'video',
          genPrompt: '',
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
          attrs: {
            ...(poster ? { poster } : { poster: '' }),
            genPrompt: '',
            cropX: 0,
            cropY: 0,
            cropW: 1,
            cropH: 1,
            trimStart: '',
            trimEnd: '',
          },
        },
        skipHistory: true,
      })
    );
  } catch (err: any) {
    if (alive()) {
      dispatch(finishImageProcess({ nodeId }));
      message.error(getHttpErrorMessage(err, '替换视频失败'));
    }
  }
}
