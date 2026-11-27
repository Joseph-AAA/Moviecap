import { NativeModule, requireOptionalNativeModule } from "expo";

export interface ProbeResult {
  /** Display width (rotation already applied). */
  width: number;
  /** Display height (rotation already applied). */
  height: number;
  rotation: number;
  frameRate: number;
  duration: number;
  videoBitrate: number;
  hasAudio: boolean;
}

export interface ProgressEvent {
  jobId: string;
  sessionId: number;
  /** Output time rendered so far, in milliseconds. */
  timeMs: number;
}

type MoviecapFfmpegEvents = {
  onProgress: (event: ProgressEvent) => void;
};

declare class MoviecapFfmpegModule extends NativeModule<MoviecapFfmpegEvents> {
  probe(path: string): Promise<ProbeResult>;
  execute(
    jobId: string,
    args: string[],
  ): Promise<{ sessionId: number; logTail: string }>;
  cancel(sessionId: number | null): void;
}

/**
 * Null when the native module is not in the installed app (an older dev
 * build, Expo Go, web). Callers must check `isRenderingAvailable()` and show
 * a friendly message instead of crashing.
 */
const MoviecapFfmpeg =
  requireOptionalNativeModule<MoviecapFfmpegModule>("MoviecapFfmpeg");

export function isRenderingAvailable(): boolean {
  return MoviecapFfmpeg !== null;
}

export default MoviecapFfmpeg;
