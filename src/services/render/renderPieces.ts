/**
 * Piece-by-piece rendering plan (pure, unit-tested with `node --test`).
 *
 * Instead of one huge FFmpeg filter graph (which can stall or buffer the
 * whole video on a phone), every timeline item is rendered by its OWN small
 * FFmpeg run, then the pieces are joined without re-encoding and the
 * original audio is added once:
 *
 *   piece i  = clip | freeze (zoomed still)      [+ transition at its start]
 *   final    = concat(pieces) re-encoded ONCE + original audio for the range
 *
 * The final step re-encodes instead of copying: a phone's hardware encoder
 * writes slightly different H.264 headers (SPS) into each piece, and a
 * stream-copied join keeps only the first one, so Android's hardware decoder
 * showed GREEN frames in later pieces. One encode gives one clean header.
 * Pieces are encoded at a higher bitrate to offset the second encode.
 *
 * Sync: piece boundaries are computed in WHOLE FRAMES from the timeline, and
 * every piece is cut to its exact frame count, so the joined video has
 * exactly round(duration * fps) frames and lines up with the audio.
 *
 * A transition into item i is rendered inside piece i as an OVERLAP: the
 * previous item's last seconds (still moving) are mixed with item i's first
 * seconds, so the effect shows between two different moments. Item i still
 * starts at the cut and the audio is the untouched original, so nothing is
 * skipped and lengths never change.
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
   * Transition INTO this piece. The outgoing layer is the last `frames` of
   * the previous piece's rendered file (`fromPiece`), so it already contains
   * a freeze's zoom, and nothing re-reads the long source video.
   */
  transitionIn: { kind: TransitionKind; frames: number; fromPiece: number } | null;
}

/**
 * xfade options for a transition kind (built-in xfade transitions in
 * FFmpeg 6.0). Checkerboard and snow drift use maskTransition instead.
 */
export function xfadeTransition(kind: TransitionKind): string {
  switch (kind) {
    case "wipe":
      return "transition=wipeleft";
    case "pixelize":
      return "transition=pixelize";
    case "elastic":
      return "transition=squeezeh";
    case "checkerboard":
    case "snowdrift":
      // Rendered with maskTransition (fast); xfade fade is only a fallback.
      return "transition=fade";
    default:
      return `transition=${kind}`;
  }
}

/**
 * Fast mask-based version of a transition, or null to use xfade.
 * `expr` is a geq expression giving 0 (old picture) .. 255 (new picture);
 * X/W and Y/H are relative so it works on every plane; T is seconds.
 */
export function maskTransition(
  kind: TransitionKind,
  seconds: number,
  width: number,
  height: number,
): { width: number; height: number; expr: string } | null {
  const progress = `clip(T/${num(seconds, 4)},0,1)`;
  switch (kind) {
    case "checkerboard": {
      // 8 squares across. Even squares change in the first half, odd ones
      // in the second half, each with a short soft fade.
      const rows = even((8 * height) / width);
      const parity = `mod(floor(X/W*8)+floor(Y/H*${rows}),2)`;
      return {
        width: 8,
        height: rows,
        expr: `255*clip((${progress}-${parity}*0.5)*2,0,1)`,
      };
    }
    case "snowdrift": {
      // Chunky snow: a noisy edge drifting from the top to the bottom.
      const cols = 72;
      return {
        width: cols,
        height: even((cols * height) / width),
        expr: `255*gte(${progress}*1.6-0.6*Y/H-0.4*random(0),0)`,
      };
    }
    default:
      return null;
  }
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
    // Input 1: the LAST `frames` of the previous piece, still MOVING (an
    // overlap transition between two different moments, so the effect is
    // clearly visible). -sseof seeks that far before its end; -t limits the
    // read. The incoming piece still starts at the cut and the original
    // audio is untouched, so nothing is skipped and sync is kept.
    inputs.push(
      "-sseof",
      num(-frames / fps, 4),
      "-t",
      num(frames / fps + STILL_READ_SECONDS),
      "-i",
      previousPiecePath,
    );
    const mask = maskTransition(kind, frames / fps, width, height);
    // If the read comes up a frame short, repeat its last frame.
    const outgoing = (length: number) =>
      `[1:v]setpts=PTS-STARTPTS,${normalise},` +
      `tpad=stop_mode=clone:stop_duration=${num(length / fps + 1)},trim=end_frame=${length}[h]`;

    if (!mask) {
      filters.push(outgoing(frames));
      filters.push(`[h][o]xfade=${xfadeTransition(kind)}:duration=${num(frames / fps, 4)}:offset=0[v]`);
    } else {
      // Mask transitions: the pattern is computed on a TINY image and
      // enlarged with hard edges, then mixes old (A) into new (B). This is
      // ~100x faster than a per-pixel xfade expression on a phone.
      // A is padded to the whole piece; after the transition the mask is
      // fully "new", so only B shows.
      filters.push(outgoing(piece.frames));
      filters.push(
        `color=c=black:s=${mask.width}x${mask.height}:r=${fps}:d=${num(piece.frames / fps + 1)},format=yuv420p,` +
          `geq=lum='${mask.expr}':cb='${mask.expr}':cr='${mask.expr}',` +
          `scale=${width}:${height}:flags=neighbor,format=yuv420p,setsar=1,settb=AVTB,` +
          `trim=end_frame=${piece.frames}[m]`,
      );
      filters.push(`[h][o][m]maskedmerge[v]`);
    }
  }

  const videoCodec = videoCodecArgs(encoder, source, "piece");

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

/**
 * Encoder arguments. Pieces are temporary, so they get twice the bitrate
 * (and a finer mpeg4 quantiser) to keep quality after the final encode.
 */
export function videoCodecArgs(
  encoder: VideoEncoder,
  source: SourceInfo,
  stage: "piece" | "final",
): string[] {
  const fps = outputFps(source);
  const base = source.videoBitrate > 0 ? Math.round(source.videoBitrate) : FALLBACK_BITRATE;
  const bitrate = Math.min(MAX_BITRATE, stage === "piece" ? base * 2 : base);
  return encoder === "h264_mediacodec"
    ? ["-c:v", "h264_mediacodec", "-b:v", String(bitrate), "-g", String(Math.round(fps))]
    : ["-c:v", "mpeg4", "-q:v", stage === "piece" ? "2" : "3", "-g", String(Math.round(fps))];
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
  source: SourceInfo;
  encoder: VideoEncoder;
}

/**
 * Join the pieces (re-encoding the video ONCE, so the file has a single
 * consistent H.264 header) and add the original audio for the same range.
 */
export function buildFinalArgs(input: FinalArgsInput): string[] {
  const { listPath, inputPath, outputPath, rangeStart, duration, hasAudio, source, encoder } = input;
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
    ...videoCodecArgs(encoder, source, "final"),
    "-t", num(duration),
    "-movflags", "+faststart",
    outputPath,
  ];
}
