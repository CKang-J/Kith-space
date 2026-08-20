/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/audioExporter.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Extract audio from video as MP3 via FFmpeg.wasm (singleton). */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
/** Package export — keep as URL (not blob) so worker's relative imports resolve. */
import ffmpegWorkerURL from '@ffmpeg/ffmpeg/worker?url';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

/** Local static files under `apps/web/public/ffmpeg` (esm, from `@ffmpeg/core`). */
function coreBaseURL(): string {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}ffmpeg`;
}

async function loadFfmpegOnce(): Promise<FFmpeg> {
  const ff = new FFmpeg();
  const base = coreBaseURL();
  // Must use **esm** core: module worker does `import(coreURL).default`.
  await ff.load({
    classWorkerURL: ffmpegWorkerURL,
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ff;
  return ff;
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    try {
      return await loadFfmpegOnce();
    } catch (err) {
      ffmpegInstance = null;
      throw err;
    }
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'mp4';
}

export type ExportVideoAudioOpts = {
  file: File | Blob;
  /** Clip start (seconds). Prefer input-seek for speed. */
  trimStart?: number;
  /** Clip end (seconds, absolute). */
  trimEnd?: number;
  /** kbps — lower is faster. Default 128. */
  bitrate?: number;
  /** Sample rate Hz. Default 44100. */
  sampleRate?: number;
};

/** Video/audio file → MP3 blob (`-vn -c:a libmp3lame`). */
export async function exportVideoAudio(
  opts: ExportVideoAudioOpts
): Promise<{ blob: Blob; ext: 'mp3' }> {
  const ffmpeg = await getFFmpeg();
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const srcName =
    opts.file instanceof File && opts.file.name
      ? opts.file.name
      : 'input.mp4';
  const inputName = `in_${id}.${extOf(srcName)}`;
  const outputName = `out_${id}.mp3`;

  await ffmpeg.writeFile(inputName, await fetchFile(opts.file));

  const bitrate = Math.max(64, Math.min(320, Number(opts.bitrate) || 128));
  const sampleRate = Number(opts.sampleRate) || 44100;
  const hasStart = Number.isFinite(opts.trimStart) && Number(opts.trimStart) > 0;
  const hasEnd = Number.isFinite(opts.trimEnd) && Number(opts.trimEnd) > 0;

  const args: string[] = [];
  if (hasStart) args.push('-ss', String(Number(opts.trimStart)));
  if (hasEnd) args.push('-to', String(Number(opts.trimEnd)));
  args.push(
    '-i',
    inputName,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${bitrate}k`,
    '-ar',
    String(sampleRate),
    '-y',
    outputName
  );

  try {
    await ffmpeg.exec(args);
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    if (!blob.size) throw new Error('empty mp3');
    return { blob, ext: 'mp3' };
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* ignore */
    }
  }
}
