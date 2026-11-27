import { File } from "expo-file-system";

import MoviecapFfmpeg, {
  isRenderingAvailable,
} from "../../../modules/moviecap-ffmpeg";
import { addProjectExport } from "@/services/database";
import {
  buildRenderArgs,
  type SourceInfo,
  type VideoEncoder,
} from "@/services/render/renderCommand";
import { buildTimeline } from "@/services/timeline/editTimeline";
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
 * Render the project's saved edit to a NEW mp4 in the project folder and
 * record it as a clip. The source video is only ever read.
 *
 * Encoder strategy: hardware H.264 first (fast, small files); if the device's
 * encoder rejects the job, retry once with the software mpeg4 encoder.
 */
export function renderProjectEdit(
  projectId: string,
  config: EditConfig,
  onProgress: (fraction: number) => void,
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
  let sessionId: number | null = null;
  let cancelled = false;

  const subscription = native.addListener("onProgress", (event) => {
    if (event.jobId !== jobId) return;
    sessionId = event.sessionId;
    const total = buildTimeline(config).outputDuration;
    if (total > 0) onProgress(Math.min(1, event.timeMs / 1000 / total));
  });

  const done = (async () => {
    const output = new File(createProjectDirectory(projectId), `edit-${Date.now()}.mp4`);

    try {
      const probe = await native.probe(toFsPath(config.sourceUri));
      const source: SourceInfo = {
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        hasAudio: probe.hasAudio,
        videoBitrate: probe.videoBitrate,
      };
      const timeline = buildTimeline(config);

      const run = (encoder: VideoEncoder) =>
        native.execute(
          jobId,
          buildRenderArgs({
            timeline,
            source,
            inputPath: toFsPath(config.sourceUri),
            outputPath: toFsPath(output.uri),
            encoder,
          }),
        );

      try {
        await run("h264_mediacodec");
      } catch (error) {
        if (cancelled || isCancelError(error)) throw new RenderCancelledError();
        console.warn("Hardware encoder failed, retrying with software:", error);
        onProgress(0);
        await run("mpeg4");
      }

      if (cancelled) throw new RenderCancelledError();
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
