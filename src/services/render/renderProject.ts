import { Directory, File, Paths } from "expo-file-system";

import MoviecapFfmpeg, {
  isRenderingAvailable,
} from "../../../modules/moviecap-ffmpeg";
import { addProjectExport, getProjectExports } from "@/services/database";
import {
  buildConcatList,
  buildFinalArgs,
  buildPieceArgs,
  outputFps,
  planPieces,
  type SourceInfo,
  type VideoEncoder,
} from "@/services/render/renderPieces";
import { buildTimeline, cropTimeline } from "@/services/timeline/editTimeline";
import { createProjectDirectory } from "@/services/videoStorage";
import type { EditConfig } from "@/types/edit";

export { isRenderingAvailable };

export interface RenderHandle {
  /** Resolves with the rendered file URI; rejects on failure or cancel. */
  done: Promise<string>;
  cancel: () => void;
}

export class RenderCancelledError extends Error {
  constructor() {
    super("Rendering was cancelled.");
    this.name = "RenderCancelledError";
  }
}

/** FFmpeg needs a plain filesystem path, not a file:// URI. */
function toFsPath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ""));
}

function isCancelError(error: unknown): boolean {
  return (
    error instanceof RenderCancelledError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ERR_FFMPEG_CANCELLED")
  );
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

/**
 * Remove what an earlier render left behind when the app was killed
 * mid-render (Android does that when memory runs out): temporary piece
 * folders in the cache, and edit-*.mp4 files in the project folder that were
 * never recorded as a clip. Recorded clips and the original are never
 * touched.
 */
async function cleanUpRenderLeftovers(projectId: string): Promise<void> {
  try {
    for (const item of new Directory(Paths.cache).list()) {
      if (item instanceof Directory && item.name.startsWith("render-job-")) item.delete();
    }

    // Compare by FILE NAME (unique per render), not full URI, so a different
    // URI spelling can never make a real clip look like an orphan.
    const recorded = new Set(
      (await getProjectExports(projectId)).map((e) => decodeURI(e.uri).split("/").pop()),
    );
    for (const item of createProjectDirectory(projectId).list()) {
      if (item instanceof File && /^edit-\d+\.mp4$/.test(item.name) && !recorded.has(item.name)) {
        item.delete();
      }
    }
  } catch (error) {
    // Cleanup must never block a new export.
    console.warn("Could not clean up old render files:", error);
  }
}

/** Share of the progress bar used by the pieces; the rest is the final encode. */
const PIECES_SHARE = 0.65;

interface RenderJob {
  config: EditConfig;
  range: { start: number; end: number };
  output: File;
  onProgress: (fraction: number) => void;
  /** Render smaller than the source (for quick previews). */
  maxWidth?: number;
  beforeStart?: () => Promise<void>;
  /** Called after the file is written; failures delete the output. */
  afterSuccess?: (outputDuration: number) => Promise<void>;
}

/**
 * Shared renderer used by Export and Preview. Piece by piece (see
 * renderPieces.ts): each timeline item is a small FFmpeg run, the pieces are
 * joined with ONE final encode and the original audio is added. Memory stays
 * small for any video length. The source video is only ever read.
 *
 * Encoder: hardware H.264 first; if the device's encoder fails, ALL pieces
 * are rendered again with the software mpeg4 encoder.
 */
function startRender(job: RenderJob): RenderHandle {
  const { config, range, output, onProgress } = job;
  const native = MoviecapFfmpeg;
  if (!native) {
    return {
      done: Promise.reject(
        new Error("This app version can't render effects yet. Install the latest build."),
      ),
      cancel: () => {},
    };
  }

  const jobId = `job-${Date.now()}`;
  const timeline = cropTimeline(buildTimeline(config), range.start, range.end);
  let sessionId: number | null = null;
  let cancelled = false;

  // Progress inside the current FFmpeg run (frames rendered so far).
  let progressBase = 0;
  let progressSpan = 0;
  let runFrames = 1;
  let fps = 30;

  const subscription = native.addListener("onProgress", (event) => {
    if (event.jobId !== jobId) return;
    sessionId = event.sessionId;
    const inRun = Math.min(1, ((event.timeMs / 1000) * fps) / Math.max(1, runFrames));
    onProgress(Math.min(0.999, progressBase + progressSpan * inRun));
  });

  const run = async (args: string[]) => {
    if (cancelled) throw new RenderCancelledError();
    await native.execute(jobId, args);
    if (cancelled) throw new RenderCancelledError();
  };

  const done = (async () => {
    const workDir = new Directory(Paths.cache, `render-${jobId}`);

    try {
      if (timeline.items.length === 0) throw new Error("The selected range is empty.");
      await job.beforeStart?.();

      const inputPath = toFsPath(config.sourceUri);
      const probe = await native.probe(inputPath);
      const scale =
        job.maxWidth && probe.width > job.maxWidth ? job.maxWidth / probe.width : 1;
      const source: SourceInfo = {
        width: even(probe.width * scale),
        height: even(probe.height * scale),
        frameRate: probe.frameRate,
        hasAudio: probe.hasAudio,
        videoBitrate: probe.videoBitrate * scale * scale,
      };
      fps = outputFps(source);

      const pieces = planPieces(timeline, fps);
      const totalFrames = pieces.reduce((sum, p) => sum + p.frames, 0);
      if (pieces.length === 0 || totalFrames === 0) throw new Error("The selected range is empty.");

      workDir.create({ intermediates: true, idempotent: true });
      const piecePath = (i: number) =>
        toFsPath(new File(workDir, `piece-${String(i).padStart(4, "0")}.mp4`).uri);

      const renderAll = async (encoder: VideoEncoder) => {
        let framesDone = 0;
        for (const piece of pieces) {
          progressBase = (framesDone / totalFrames) * PIECES_SHARE;
          progressSpan = (piece.frames / totalFrames) * PIECES_SHARE;
          runFrames = piece.frames;
          await run(
            buildPieceArgs({
              piece,
              source,
              inputPath,
              outputPath: piecePath(piece.index),
              encoder,
              previousPiecePath: piece.transitionIn
                ? piecePath(piece.transitionIn.fromPiece)
                : undefined,
            }),
          );
          framesDone += piece.frames;
          onProgress((framesDone / totalFrames) * PIECES_SHARE);
        }
      };

      let encoder: VideoEncoder = "h264_mediacodec";
      try {
        await renderAll(encoder);
      } catch (error) {
        if (cancelled || isCancelError(error)) throw new RenderCancelledError();
        console.warn("Hardware encoder failed, rendering again with software:", error);
        onProgress(0);
        encoder = "mpeg4";
        await renderAll(encoder);
      }

      // Join + one final encode + original audio for the range.
      const listFile = new File(workDir, "pieces.txt");
      listFile.create({ overwrite: true });
      // write() is async in this expo-file-system version: wait for it, or
      // FFmpeg reads an empty list ("No files to concat").
      await listFile.write(buildConcatList(pieces.map((p) => piecePath(p.index))));

      progressBase = PIECES_SHARE;
      progressSpan = 1 - PIECES_SHARE;
      runFrames = totalFrames;
      const finalArgs = (finalEncoder: VideoEncoder) =>
        buildFinalArgs({
          listPath: toFsPath(listFile.uri),
          inputPath,
          outputPath: toFsPath(output.uri),
          rangeStart: range.start,
          duration: timeline.outputDuration,
          hasAudio: source.hasAudio,
          source,
          encoder: finalEncoder,
        });
      try {
        await run(finalArgs(encoder));
      } catch (error) {
        if (cancelled || isCancelError(error) || encoder === "mpeg4") throw error;
        console.warn("Hardware encoder failed on the final step, using software:", error);
        await run(finalArgs("mpeg4"));
      }

      if (!output.exists || output.size === 0) {
        throw new Error("Rendering finished but no video was written.");
      }

      await job.afterSuccess?.(timeline.outputDuration);
      onProgress(1);
      return output.uri;
    } catch (error) {
      // Never leave a half-written file behind.
      try {
        if (output.exists) output.delete();
      } catch (cleanupError) {
        console.warn("Could not remove partial render:", cleanupError);
      }
      throw isCancelError(error) || cancelled ? new RenderCancelledError() : error;
    } finally {
      subscription.remove();
      try {
        if (workDir.exists) workDir.delete();
      } catch (cleanupError) {
        console.warn("Could not remove render pieces:", cleanupError);
      }
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      native.cancel(sessionId);
    },
  };
}

/**
 * Export: render the project's saved edit for `range` (the trim selection)
 * to a NEW mp4 in the project folder and record it as a clip.
 */
export function renderProjectEdit(
  projectId: string,
  config: EditConfig,
  onProgress: (fraction: number) => void,
  range: { start: number; end: number } = { start: 0, end: config.sourceDuration },
): RenderHandle {
  const output = new File(createProjectDirectory(projectId), `edit-${Date.now()}.mp4`);
  return startRender({
    config,
    range,
    output,
    onProgress,
    beforeStart: () => cleanUpRenderLeftovers(projectId),
    afterSuccess: (duration) =>
      addProjectExport(
        projectId,
        output.uri,
        duration,
        `Edited · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      ),
  });
}

/** Seconds of normal video shown before and after a previewed transition. */
const PREVIEW_MARGIN_SECONDS = 1.5;
const PREVIEW_MAX_WIDTH = 360;

/** Where a transition preview at `cutTime` starts and ends (source seconds). */
export function transitionPreviewRange(
  config: EditConfig,
  cutTime: number,
  transitionSeconds: number,
): { start: number; end: number } {
  // The outgoing layer is the last `transitionSeconds` before the cut, so
  // start early enough to include it plus a short lead-in.
  return {
    start: Math.max(0, cutTime - transitionSeconds - PREVIEW_MARGIN_SECONDS),
    end: Math.min(config.sourceDuration, cutTime + transitionSeconds + PREVIEW_MARGIN_SECONDS),
  };
}

/**
 * Preview: render ONE transition exactly like the export will (same engine),
 * but small (360 px wide) and only around the cut, into a temporary file.
 * Nothing is saved to the project; older previews are deleted first.
 */
export function renderTransitionPreview(
  config: EditConfig,
  cutTime: number,
  transitionSeconds: number,
  onProgress: (fraction: number) => void,
): RenderHandle {
  const previews = new Directory(Paths.cache, "transition-previews");
  try {
    if (previews.exists) previews.delete();
    previews.create({ intermediates: true, idempotent: true });
  } catch (error) {
    console.warn("Could not reset preview folder:", error);
  }

  return startRender({
    config,
    range: transitionPreviewRange(config, cutTime, transitionSeconds),
    output: new File(previews, `preview-${Date.now()}.mp4`),
    onProgress,
    maxWidth: PREVIEW_MAX_WIDTH,
  });
}

const EDITED_PREVIEW_MAX_WIDTH = 480;

/** Short stable hash of what affects the picture (not timestamps). */
function editFingerprint(config: EditConfig): string {
  const relevant = JSON.stringify({
    source: config.sourceUri,
    duration: Math.round(config.sourceDuration * 1000),
    segments: config.defaultEdit?.segments ?? [],
    transitions: [...(config.defaultEdit?.transitions ?? []), ...config.custom.transitions],
    freezes: [...(config.defaultEdit?.freezes ?? []), ...config.custom.freezes],
    blurs: config.custom.blurs,
  });
  let hash = 5381;
  for (let i = 0; i < relevant.length; i++) {
    hash = ((hash << 5) + hash + relevant.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * The whole edited video, rendered small (480 px wide) for the Edit page
 * player, so effects are seen exactly as exported without exporting.
 * Effects never change timing, so it lines up 1:1 with the original.
 * Cached per project + edit: reopening an unchanged edit is instant.
 * Nothing is saved to the project's clips.
 */
export function renderEditedPreview(
  projectId: string,
  config: EditConfig,
  onProgress: (fraction: number) => void,
): RenderHandle {
  const folder = new Directory(Paths.cache, "edited-previews", projectId);
  const name = `edited-${editFingerprint(config)}`;
  const output = new File(folder, `${name}.mp4`);
  // Render to ".part" and rename only when complete, so a render killed
  // half-way is never mistaken for a finished preview next time.
  const partial = new File(folder, `${name}.part.mp4`);

  try {
    if (output.exists && output.size > 0) {
      onProgress(1);
      return { done: Promise.resolve(output.uri), cancel: () => {} };
    }
    // Only one preview per project: remove previews of older edits.
    if (folder.exists) folder.delete();
    folder.create({ intermediates: true, idempotent: true });
  } catch (error) {
    console.warn("Could not prepare the preview folder:", error);
  }

  return startRender({
    config,
    range: { start: 0, end: config.sourceDuration },
    output: partial,
    onProgress,
    maxWidth: EDITED_PREVIEW_MAX_WIDTH,
    // move() updates `partial` to point at the final name, which startRender
    // then returns.
    afterSuccess: () => partial.move(output),
  });
}
