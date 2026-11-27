/**
 * Builds the FFmpeg argument list that renders a resolved Timeline.
 * Pure (no React/native imports) so it can be unit-tested with `node --test`
 * and run against a desktop FFmpeg for verification.
 *
 * Filter graph shape:
 *   [0:v] split -> one branch per timeline item
 *     clip   : trim -> normalise -> (tpad if a transition follows)
 *     freeze : one frame -> 2x upscale -> zoompan (eased zoom) -> normalise
 *   items are joined left to right with xfade (transition) or concat (cut).
 *   Audio: clips use the matching atrim, freezes use silence, all concat'ed.
 *
 * Sync guarantee: a transition pads the outgoing VIDEO item by exactly the
 * overlap xfade removes, so every video item starts at the same output time
 * as in the timeline. Audio pieces are NOT padded and are simply
 * concatenated, so each audio piece starts at that same time too.
 *
 * Only filters present in the bundled FFmpegKit "min" build are used
 * (checked against the shipped libavfilter.so).
 */

import type { Timeline, ZoomDirection } from "@/types/edit";

export interface SourceInfo {
  /** Display width/height (rotation applied). */
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  videoBitrate: number;
}

export type VideoEncoder = "h264_mediacodec" | "mpeg4";

export interface RenderCommandInput {
  timeline: Timeline;
  source: SourceInfo;
  inputPath: string;
  outputPath: string;
  encoder: VideoEncoder;
}

const AUDIO_RATE = 48000;
const DEFAULT_FPS = 30;
const MAX_FPS = 60;
const FALLBACK_BITRATE = 8_000_000;
const MAX_BITRATE = 20_000_000;

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
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";

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
      return { x: centerX, y: centerY };
  }
}

export function buildRenderArgs(input: RenderCommandInput): string[] {
  const { timeline, source, inputPath, outputPath, encoder } = input;
  const items = timeline.items;

  if (items.length === 0) {
    throw new Error("Nothing to render: the timeline is empty.");
  }

  const width = even(source.width);
  const height = even(source.height);
  const fps = outputFps(source);
  const normalise = `fps=${fps},scale=${width}:${height}:flags=bicubic,setsar=1,format=yuv420p,settb=AVTB`;

  // How long each output item is padded so a following xfade loses nothing.
  const padAfter = new Array<number>(items.length).fill(0);
  for (const cut of timeline.cuts) {
    if (cut.transition) padAfter[cut.afterItemIndex] = cut.transition.duration;
  }

  const filters: string[] = [];

  // ---- Video branches -----------------------------------------------------
  const videoLabels = items.map((_, i) => `vs${i}`);
  filters.push(
    items.length === 1
      ? `[0:v]null[${videoLabels[0]}]`
      : `[0:v]split=${items.length}${videoLabels.map((l) => `[${l}]`).join("")}`,
  );

  /** Video length of each item including transition padding. */
  const itemLengths: number[] = [];
  /** Real length of each item (what the audio uses). */
  const baseLengths: number[] = [];

  items.forEach((item, i) => {
    const pad = padAfter[i] > 0 ? `,tpad=stop_mode=clone:stop_duration=${num(padAfter[i])}` : "";

    if (item.type === "clip") {
      filters.push(
        `[${videoLabels[i]}]trim=start=${num(item.sourceStart)}:end=${num(item.sourceEnd)},` +
          `setpts=PTS-STARTPTS,${normalise}${pad}[v${i}]`,
      );
      baseLengths.push(item.sourceEnd - item.sourceStart);
      itemLengths.push(baseLengths[i] + padAfter[i]);
      return;
    }

    const { freeze } = item;
    const frames = Math.max(2, Math.round(freeze.duration * fps));
    // Smoothstep easing: gradual start and gradual stop (cinematic, no jerk).
    const p = `(on/${frames - 1})`;
    const zoom =
      `${num(freeze.zoomFrom)}+(${num(freeze.zoomTo - freeze.zoomFrom)})*${p}*${p}*(3-2*${p})`;
    const origin = zoomOrigin(freeze.zoomDirection);

    filters.push(
      `[${videoLabels[i]}]trim=start=${num(freeze.sourceTime)},setpts=PTS-STARTPTS,trim=end_frame=1,` +
        // Upscale before zoompan so its integer crop steps are sub-pixel in
        // the output: removes the well-known zoompan jitter.
        `scale=${width * 2}:${height * 2}:flags=lanczos,` +
        `zoompan=z='${zoom}':x='${origin.x}':y='${origin.y}':d=${frames}:s=${width}x${height}:fps=${fps},` +
        `${normalise}${pad}[v${i}]`,
    );
    baseLengths.push(frames / fps);
    itemLengths.push(baseLengths[i] + padAfter[i]);
  });

  // ---- Join video: xfade at transitions, concat at plain cuts -------------
  let current = "v0";
  let currentLength = itemLengths[0];

  for (let i = 1; i < items.length; i++) {
    const cut = timeline.cuts.find((c) => c.afterItemIndex === i - 1);
    const next = `x${i}`;

    if (cut?.transition) {
      const duration = cut.transition.duration;
      const offset = Math.max(0, currentLength - duration);
      filters.push(
        `[${current}][v${i}]xfade=transition=${cut.transition.kind}:duration=${num(duration)}:offset=${num(offset)}[${next}]`,
      );
      currentLength = offset + itemLengths[i];
    } else {
      filters.push(`[${current}][v${i}]concat=n=2:v=1:a=0[${next}]`);
      currentLength += itemLengths[i];
    }
    current = next;
  }
  filters.push(`[${current}]null[vout]`);

  // ---- Audio -------------------------------------------------------------
  const audioFormat = `aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo`;
  const clipIndexes = items.flatMap((item, i) => (item.type === "clip" ? [i] : []));
  const useSourceAudio = source.hasAudio && clipIndexes.length > 0;

  if (useSourceAudio) {
    filters.push(
      clipIndexes.length === 1
        ? `[0:a]anull[as${clipIndexes[0]}]`
        : `[0:a]asplit=${clipIndexes.length}${clipIndexes.map((i) => `[as${i}]`).join("")}`,
    );
  }

  items.forEach((item, i) => {
    if (item.type === "clip" && useSourceAudio) {
      filters.push(
        `[as${i}]atrim=start=${num(item.sourceStart)}:end=${num(item.sourceEnd)},asetpts=PTS-STARTPTS,` +
          `${audioFormat}[a${i}]`,
      );
    } else {
      // Freeze (or no source audio): silence. Original audio pauses here.
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE},atrim=duration=${num(baseLengths[i])},${audioFormat}[a${i}]`,
      );
    }
  });

  filters.push(
    `${items.map((_, i) => `[a${i}]`).join("")}concat=n=${items.length}:v=0:a=1[aout]`,
  );

  // ---- Encoding ----------------------------------------------------------
  const bitrate = Math.min(
    MAX_BITRATE,
    source.videoBitrate > 0 ? Math.round(source.videoBitrate) : FALLBACK_BITRATE,
  );
  const videoCodec =
    encoder === "h264_mediacodec"
      ? ["-c:v", "h264_mediacodec", "-b:v", String(bitrate)]
      : ["-c:v", "mpeg4", "-q:v", "3"];

  return [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    ...videoCodec,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    String(AUDIO_RATE),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/** Expected output length in seconds (for progress %). */
export function expectedOutputDuration(timeline: Timeline): number {
  return timeline.outputDuration;
}
