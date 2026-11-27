/**
 * Piece-by-piece rendering plan (pure, unit-tested with `node --test`).
 *
 * Instead of one huge FFmpeg filter graph (which can stall or buffer the
 * whole video on a phone), every timeline item is rendered by its OWN small
 * FFmpeg run, then the pieces are joined without re-encoding and the
 * original audio is added once:
 *
 *   piece i  = clip | freeze (zoomed still)      [+ transition at its start]
 *   final    = concat(pieces, stream copy) + original audio for the range
 *
 * Sync: piece boundaries are computed in WHOLE FRAMES from the timeline, and
 * every piece is cut to its exact frame count, so the joined video has
 * exactly round(duration * fps) frames and lines up with the audio.
 *
 * A transition into item i is rendered inside piece i: the previous item's
 * final picture is held for the transition and dissolves into the start of
 * item i. Nothing is added or removed, so lengths never change.
 *
 * Only filters present in the bundled FFmpegKit "min" build are used.
 */

import type { FreezeEffect, Timeline, TransitionKind, ZoomDirection } from "@/types/edit";

export interface SourceInfo {
  /** Display width/height (rotation applied). */
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  videoBitrate: number;
}

export type VideoEncoder = "h264_mediacodec" | "mpeg4";

const AUDIO_RATE = 48000;
const DEFAULT_FPS = 30;
const MAX_FPS = 60;
const FALLBACK_BITRATE = 8_000_000;
const MAX_BITRATE = 20_000_000;

export interface PiecePlan {
  index: number;
  frames: number;
  content:
    | { type: "clip"; sourceStart: number }
    | { type: "freeze"; freeze: FreezeEffect; zoomFrom: number; zoomTo: number };
  /**
   * Dissolve INTO this piece. Its still is the last frame of the previous
   * piece's rendered file (`fromPiece`), so it already has the exact final
   * zoom of a freeze, and nothing re-reads the long source video.
   */
  transitionIn: { kind: TransitionKind; frames: number; fromPiece: number } | null;
}

/** Fixed-precision number for filter strings (avoids 1e-7 style output). */
function num(value: number, digits = 3): string {
  return Number(value.toFixed(digits)).toString();
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

export function outputFps(source: SourceInfo): number {
  const fps = source.frameRate;
  if (!Number.isFinite(fps) || fps < 10) return DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.round(fps * 100) / 100);
}

function zoomOrigin(direction: ZoomDirection): { x: string; y: string } {
  const right = "iw-iw/zoom";
  const bottom = "ih-ih/zoom";
  switch (direction) {
    case "top-left":
      return { x: "0", y: "0" };
    case "top-right":
      return { x: right, y: "0" };
    case "bottom-left":
      return { x: "0", y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    default:
      return { x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" };
  }
}

/**
 * Split the (cropped) timeline into pieces with exact frame counts.
 * Items shorter than one frame are skipped.
 */
export function planPieces(timeline: Timeline, fps: number): PiecePlan[] {
  const toFrame = (seconds: number) => Math.round(seconds * fps);
  // The very end rounds DOWN: a 40.033 s video at 30 fps has 1200 frames,
  // not 1201, so never ask the last piece for a frame that doesn't exist.
  const lastFrame = Math.floor(timeline.outputDuration * fps + 1e-6);
  const endFrame = (seconds: number) => Math.min(lastFrame, toFrame(seconds));
  const plans: PiecePlan[] = [];
  const planIndexOfItem = new Map<number, number>();

  timeline.items.forEach((item, i) => {
    const frames = endFrame(item.outputEnd) - endFrame(item.outputStart);
    if (frames <= 0) return;

    planIndexOfItem.set(i, plans.length);
    plans.push({
      index: plans.length,
      frames,
      content:
        item.type === "clip"
          ? { type: "clip", sourceStart: item.sourceStart }
          : {
              type: "freeze",
              freeze: item.freeze,
              zoomFrom: item.freeze.zoomFrom,
              zoomTo: item.freeze.zoomTo,
            },
      transitionIn: null,
    });
  });

  for (const cut of timeline.cuts) {
    if (!cut.transition) continue;
    const afterPlan = planIndexOfItem.get(cut.afterItemIndex + 1);
    const beforePlan = planIndexOfItem.get(cut.afterItemIndex);
    if (afterPlan === undefined || beforePlan === undefined) continue;

    const frames = Math.min(
      Math.max(1, toFrame(cut.transition.duration)),
      plans[afterPlan].frames,
      plans[beforePlan].frames,
    );
    if (frames < 2) continue; // too short to see; plain cut

    plans[afterPlan].transitionIn = { kind: cut.transition.kind, frames, fromPiece: beforePlan };
  }

  return plans;
}

export interface PieceArgsInput {
  piece: PiecePlan;
  source: SourceInfo;
  inputPath: string;
  outputPath: string;
  encoder: VideoEncoder;
  /** Rendered file of the previous piece (required when transitionIn). */
  previousPiecePath?: string;
}

/** FFmpeg arguments that render ONE piece (video only, exact frame count). */
export function buildPieceArgs(input: PieceArgsInput): string[] {
  const { piece, source, inputPath, outputPath, encoder, previousPiecePath } = input;
  const width = even(source.width);
  const height = even(source.height);
  const fps = outputFps(source);
  const normalise = `fps=${fps},scale=${width}:${height}:flags=bicubic,setsar=1,format=yuv420p,settb=AVTB`;

  const zoomStill = (label: string, freeze: FreezeEffect, frames: number, from: number, to: number, out: string) => {
    // Smoothstep easing: gradual start and gradual stop (cinematic, no jerk).
    const p = `(on/${Math.max(1, frames - 1)})`;
    const zoom = from === to ? num(to) : `${num(from)}+(${num(to - from)})*${p}*${p}*(3-2*${p})`;
    const origin = zoomOrigin(freeze.zoomDirection);
    return (
      `[${label}]trim=end_frame=1,setpts=PTS-STARTPTS,` +
      // Upscale first so zoompan's integer crop steps are sub-pixel: no jitter.
      `scale=${width * 2}:${height * 2}:flags=lanczos,` +
      `zoompan=z='${zoom}':x='${origin.x}':y='${origin.y}':d=${frames}:s=${width}x${height}:fps=${fps},` +
      `${normalise}[${out}]`
    );
  };

  // Every input is seeked AND length-limited (-t), so FFmpeg decodes only
  // what this piece needs. Without -t, FFmpeg 6.0 (the version on the phone)
  // keeps decoding to the end of the video and holds the frames in memory:
  // that used ~3.5 GB and Android killed the app.
  const STILL_READ_SECONDS = 0.25;
  const inputs: string[] =
    piece.content.type === "clip"
      ? ["-ss", num(piece.content.sourceStart), "-t", num(piece.frames / fps + 0.5), "-i", inputPath]
      : ["-ss", num(piece.content.freeze.sourceTime), "-t", num(STILL_READ_SECONDS), "-i", inputPath];
  const filters: string[] = [];
  const own = piece.transitionIn ? "o" : "v";

  if (piece.content.type === "clip") {
    filters.push(`[0:v]${normalise}[${own}]`);
  } else {
    filters.push(
      zoomStill("0:v", piece.content.freeze, piece.frames, piece.content.zoomFrom, piece.content.zoomTo, own),
    );
  }

  if (piece.transitionIn) {
    const { kind, frames } = piece.transitionIn;
    if (!previousPiecePath) throw new Error("A transition needs the previous piece's file.");
    // Input 1: the last frame of the previous piece. -sseof seeks to just
    // before its end, -t keeps the read to a few frames.
    inputs.push("-sseof", num(-1.2 / fps, 4), "-t", num(STILL_READ_SECONDS), "-i", previousPiecePath);
    filters.push(
      `[1:v]trim=end_frame=1,setpts=PTS-STARTPTS,${normalise},` +
        `tpad=stop_mode=clone:stop_duration=${num(frames / fps + 1)},trim=end_frame=${frames}[h]`,
    );
    filters.push(`[h][o]xfade=transition=${kind}:duration=${num(frames / fps, 4)}:offset=0[v]`);
  }

  const bitrate = Math.min(
    MAX_BITRATE,
    source.videoBitrate > 0 ? Math.round(source.videoBitrate) : FALLBACK_BITRATE,
  );
  const videoCodec =
    encoder === "h264_mediacodec"
      ? ["-c:v", "h264_mediacodec", "-b:v", String(bitrate), "-g", String(Math.round(fps))]
      : ["-c:v", "mpeg4", "-q:v", "3", "-g", String(Math.round(fps))];

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-frames:v",
    String(piece.frames),
    "-an",
    ...videoCodec,
    outputPath,
  ];
}

/** Contents of the concat-demuxer list file. */
export function buildConcatList(piecePaths: string[]): string {
  return piecePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export interface FinalArgsInput {
  listPath: string;
  inputPath: string;
  outputPath: string;
  /** Source time where the exported range starts (audio start). */
  rangeStart: number;
  /** Exported length in seconds. */
  duration: number;
  hasAudio: boolean;
}

/**
 * Join the pieces WITHOUT re-encoding the video and add the original audio
 * for the same range (re-encoded once to AAC so every phone can play it).
 */
export function buildFinalArgs(input: FinalArgsInput): string[] {
  const { listPath, inputPath, outputPath, rangeStart, duration, hasAudio } = input;
  const audio = hasAudio
    ? [
        "-ss", num(rangeStart), "-t", num(duration), "-i", inputPath,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:a", "aac", "-b:a", "160k", "-ar", String(AUDIO_RATE),
      ]
    : ["-map", "0:v:0"];

  return [
    "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    ...audio,
    "-c:v", "copy",
    "-t", num(duration),
    "-movflags", "+faststart",
    outputPath,
  ];
}
