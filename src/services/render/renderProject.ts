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
  /** Resolves with the saved file URI; rejects on failure or cancel. */
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

/**
 * Render the project's saved edit for `range` to a NEW mp4 in the project
 * folder and record it as a clip. The source video is only ever read.
 *
 * Piece by piece (see renderPieces.ts): each timeline item is a small FFmpeg
 * run, then the pieces are joined without re-encoding and the original
 * audio is added. Memory stays small for any video length.
 *
 * Encoder: hardware H.264 first; if the device's encoder fails, ALL pieces
 * are rendered again with the software mpeg4 encoder (pieces must match to
 * be joined without re-encoding).
 */
export function renderProjectEdit(
  projectId: string,
  config: EditConfig,
  onProgress: (fraction: number) => void,
  /** Source range to export (the trim selection). Default: whole video. */
  range: { start: number; end: number } = { start: 0, end: config.sourceDuration },
): RenderHandle {
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
    const inRun = Math.min(1, (event.timeMs / 1000) * fps / Math.max(1, runFrames));
    onProgress(Math.min(0.999, progressBase + progressSpan * inRun));
  });

  const run = async (args: string[]) => {
    if (cancelled) throw new RenderCancelledError();
    await native.execute(jobId, args);
    if (cancelled) throw new RenderCancelledError();
  };

  const done = (async () => {
    const workDir = new Directory(Paths.cache, `render-${jobId}`);
    const output = new File(createProjectDirectory(projectId), `edit-${Date.now()}.mp4`);

    try {
      if (timeline.items.length === 0) throw new Error("The selected range is empty.");
      await cleanUpRenderLeftovers(projectId);

      const inputPath = toFsPath(config.sourceUri);
      const probe = await native.probe(inputPath);
      const source: SourceInfo = {
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        hasAudio: probe.hasAudio,
        videoBitrate: probe.videoBitrate,
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

      // Join (no video re-encode) + original audio for the range.
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

      await addProjectExport(
        projectId,
        output.uri,
        timeline.outputDuration,
        `Edited · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      );
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
