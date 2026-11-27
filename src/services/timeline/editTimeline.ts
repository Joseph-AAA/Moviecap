/**
 * Pure editing-timeline logic (no React, no native modules, no runtime
 * imports) so it can be unit-tested with `node --test`.
 *
 * Timing model (documented decision):
 * - Freeze frames EXTEND the output. A 5 s freeze at source time t shows the
 *   frame at t for 5 s, then playback resumes at t. No source video is
 *   discarded. Original audio is silent during the freeze, and anything
 *   timed after t (dialogue, subtitles) shifts later by the freeze duration —
 *   see mapSourceToOutput.
 * - Transitions do NOT change the output length and do not drop frames: the
 *   renderer holds the outgoing item's last frame for the transition length
 *   while it dissolves into the incoming item.
 * - Segments are contiguous and in source order; they cover the whole video.
 */

import type {
  DefaultEdit,
  EditConfig,
  FreezeEffect,
  Segment,
  Timeline,
  TimelineCut,
  TimelineItem,
  TransitionEffect,
} from "@/types/edit";

// ---------------------------------------------------------------------------
// Tunable defaults (the "adjustable architecture" knobs)
// ---------------------------------------------------------------------------

export const DEFAULT_SEGMENT_DURATIONS = [15, 18, 19, 20] as const;
/** A final leftover shorter than this is merged into the previous segment. */
export const MIN_FINAL_SEGMENT = 5;
export const DEFAULT_TRANSITION_DURATION = 0.4;
export const DEFAULT_FREEZE_DURATION = 5;
export const DEFAULT_FREEZE_ZOOM_TO = 1.15;
/** Default freezes stay at least this far from cuts and from the video ends. */
export const FREEZE_EDGE_MARGIN = 2;
/** Times closer than this are treated as the same point. */
export const TIME_EPSILON = 0.05;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to milliseconds so stored JSON stays clean and comparisons stable. */
export function roundTime(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Deterministic PRNG (mulberry32). The same seed always yields the same
 * sequence, so a saved Default Edit can be rebuilt exactly.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh random seed for a new Default Edit. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function makeId(prefix: string, index: number, seed: number): string {
  return `${prefix}-${seed.toString(36)}-${index}`;
}

// ---------------------------------------------------------------------------
// Default Edit generation
// ---------------------------------------------------------------------------

/**
 * Split [0, duration] into contiguous segments whose lengths are picked at
 * random from DEFAULT_SEGMENT_DURATIONS. The last segment takes whatever is
 * left; a leftover shorter than MIN_FINAL_SEGMENT is merged into the
 * previous segment so there is never a tiny final piece.
 */
export function generateSegments(
  duration: number,
  random: () => number,
  seed: number,
): Segment[] {
  if (!(duration > 0)) return [];

  const segments: Segment[] = [];
  let start = 0;

  while (duration - start > TIME_EPSILON) {
    const remaining = duration - start;
    const pick =
      DEFAULT_SEGMENT_DURATIONS[
        Math.floor(random() * DEFAULT_SEGMENT_DURATIONS.length)
      ];

    // Last piece: the rest fits in this pick, or the leftover would be tiny.
    if (remaining <= pick || remaining - pick < MIN_FINAL_SEGMENT) {
      segments.push({
        id: makeId("seg", segments.length, seed),
        start: roundTime(start),
        end: roundTime(duration),
      });
      break;
    }

    segments.push({
      id: makeId("seg", segments.length, seed),
      start: roundTime(start),
      end: roundTime(start + pick),
    });
    start += pick;
  }

  return segments;
}

/**
 * Pick 2 or 3 freeze moments spread across the video: the video is divided
 * into equal zones and one moment is chosen inside each zone, keeping
 * FREEZE_EDGE_MARGIN away from cuts and from the start/end.
 *
 * Note: "suitable" here means well spaced and away from transitions; picking
 * by scene content would need video analysis and is out of scope.
 */
export function generateFreezes(
  duration: number,
  cutTimes: number[],
  random: () => number,
  seed: number,
): FreezeEffect[] {
  if (duration < FREEZE_EDGE_MARGIN * 2 + 1) return [];

  const count = random() < 0.5 ? 2 : 3;
  const usableStart = FREEZE_EDGE_MARGIN;
  const usableEnd = duration - FREEZE_EDGE_MARGIN;
  const zoneLength = (usableEnd - usableStart) / count;
  const freezes: FreezeEffect[] = [];

  for (let zone = 0; zone < count; zone++) {
    const zoneStart = usableStart + zone * zoneLength;

    // Try a few random spots in the middle 60% of the zone, preferring ones
    // that keep clear of cuts; fall back to the zone centre.
    let chosen = zoneStart + zoneLength / 2;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = zoneStart + zoneLength * (0.2 + random() * 0.6);
      const nearCut = cutTimes.some(
        (cut) => Math.abs(cut - candidate) < FREEZE_EDGE_MARGIN,
      );
      if (!nearCut) {
        chosen = candidate;
        break;
      }
    }

    freezes.push({
      id: makeId("frz", zone, seed),
      origin: "default",
      sourceTime: roundTime(chosen),
      duration: DEFAULT_FREEZE_DURATION,
      zoomFrom: 1,
      zoomTo: DEFAULT_FREEZE_ZOOM_TO,
      zoomDirection: "center",
    });
  }

  return freezes;
}

/** Build the complete Default Edit for a video from a seed. Deterministic. */
export function generateDefaultEdit(
  duration: number,
  seed: number,
  now: Date = new Date(),
): DefaultEdit {
  const random = createRandom(seed);
  const segments = generateSegments(duration, random, seed);
  const cutTimes = segments.slice(1).map((segment) => segment.start);

  const transitions: TransitionEffect[] = cutTimes.map((at, index) => ({
    id: makeId("trn", index, seed),
    origin: "default",
    at,
    kind: "dissolve",
    duration: DEFAULT_TRANSITION_DURATION,
  }));

  const freezes = generateFreezes(duration, cutTimes, random, seed);

  return {
    seed,
    generatedAt: now.toISOString(),
    segments,
    transitions,
    freezes,
  };
}

// ---------------------------------------------------------------------------
// Config operations (all return a NEW config; inputs are never mutated)
// ---------------------------------------------------------------------------

export function createEmptyEditConfig(
  sourceUri: string,
  sourceDuration: number,
  now: Date = new Date(),
): EditConfig {
  return {
    version: 1,
    sourceUri,
    sourceDuration,
    defaultEdit: null,
    custom: { transitions: [], freezes: [], blurs: [] },
    audio: { dubVolume: 1, originalVolume: 1, duckOriginal: true },
    subtitles: { showInPreview: true, burnIn: true },
    updatedAt: now.toISOString(),
  };
}

export function isDefaultApplied(config: EditConfig): boolean {
  return config.defaultEdit !== null;
}

/**
 * Apply (or regenerate) the Default Edit. Callers must check
 * isDefaultApplied first and ask the user before regenerating; passing
 * `regenerate: false` while one is active throws, so default effects can
 * never be stacked twice by accident.
 */
export function applyDefaultEdit(
  config: EditConfig,
  options: { seed?: number; regenerate?: boolean; now?: Date } = {},
): EditConfig {
  if (config.defaultEdit && !options.regenerate) {
    throw new Error("Default Edit is already applied.");
  }

  const now = options.now ?? new Date();

  return {
    ...config,
    defaultEdit: generateDefaultEdit(
      config.sourceDuration,
      options.seed ?? newSeed(),
      now,
    ),
    updatedAt: now.toISOString(),
  };
}

/** Remove ONLY the Default Edit. Custom effects and settings are untouched. */
export function unapplyDefaultEdit(
  config: EditConfig,
  now: Date = new Date(),
): EditConfig {
  return { ...config, defaultEdit: null, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Resolving the timeline
// ---------------------------------------------------------------------------

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < TIME_EPSILON;
}

/**
 * Transitions that take effect, one per cut point.
 * Conflict rule: if a custom and a default transition share a cut point,
 * the CUSTOM one wins. The default one stays stored, so removing the custom
 * transition brings the default back.
 */
export function resolveTransitions(config: EditConfig): TransitionEffect[] {
  const resolved = [...config.custom.transitions];

  for (const def of config.defaultEdit?.transitions ?? []) {
    if (!resolved.some((custom) => sameTime(custom.at, def.at))) {
      resolved.push(def);
    }
  }

  return resolved
    .filter((t) => t.at > TIME_EPSILON && t.at < config.sourceDuration - TIME_EPSILON)
    .sort((a, b) => a.at - b.at);
}

/** All freezes (default + custom), in source order, inside the video. */
export function resolveFreezes(config: EditConfig): FreezeEffect[] {
  return [...(config.defaultEdit?.freezes ?? []), ...config.custom.freezes]
    .filter(
      (f) =>
        f.duration > 0 &&
        f.sourceTime >= 0 &&
        f.sourceTime <= config.sourceDuration,
    )
    .sort((a, b) => a.sourceTime - b.sourceTime);
}

/**
 * Turn the stored config into the exact sequence the renderer and the
 * preview follow: clips and freezes in output order, the cuts between them,
 * and the final output duration.
 *
 * Cut rules:
 * - Cuts come from default segment boundaries and custom transition points.
 * - Entering and leaving a freeze is a seamless cut (same frame) with no
 *   transition, unless a transition sits at that exact time — then it is
 *   played AFTER the freeze, when motion resumes.
 * - A transition never lasts longer than half of the shorter item around it.
 */
export function buildTimeline(config: EditConfig): Timeline {
  const duration = config.sourceDuration;
  const transitions = resolveTransitions(config);
  const freezes = resolveFreezes(config);

  // Every source time where the clip must be split.
  const splitTimes = new Set<number>();
  for (const segment of config.defaultEdit?.segments ?? []) {
    if (segment.start > TIME_EPSILON) splitTimes.add(segment.start);
  }
  for (const t of transitions) splitTimes.add(t.at);
  for (const f of freezes) {
    if (f.sourceTime > TIME_EPSILON && f.sourceTime < duration - TIME_EPSILON) {
      splitTimes.add(f.sourceTime);
    }
  }

  // Merge split points that are effectively the same time.
  const points = [...splitTimes]
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || !sameTime(t, all[i - 1]));

  const items: TimelineItem[] = [];
  const cuts: TimelineCut[] = [];
  let output = 0;

  const pushFreezesAt = (time: number) => {
    for (const freeze of freezes.filter((f) => sameTime(f.sourceTime, time))) {
      if (items.length > 0) {
        cuts.push({ sourceTime: time, afterItemIndex: items.length - 1, transition: null });
      }
      items.push({
        type: "freeze",
        freeze,
        outputStart: roundTime(output),
        outputEnd: roundTime(output + freeze.duration),
      });
      output += freeze.duration;
    }
  };

  const boundaries = [0, ...points, duration];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];

    // Freezes sitting exactly at this boundary come before the next clip.
    pushFreezesAt(start);

    if (end - start <= TIME_EPSILON) continue;

    if (items.length > 0) {
      const transition = transitions.find((t) => sameTime(t.at, start)) ?? null;
      cuts.push({ sourceTime: start, afterItemIndex: items.length - 1, transition });
    }

    items.push({
      type: "clip",
      sourceStart: roundTime(start),
      sourceEnd: roundTime(end),
      outputStart: roundTime(output),
      outputEnd: roundTime(output + (end - start)),
    });
    output += end - start;
  }

  // A freeze on the very last frame.
  pushFreezesAt(duration);

  // Clamp transition lengths so they always fit the items around them.
  const clampedCuts = cuts.map((cut) => {
    if (!cut.transition) return cut;

    const before = items[cut.afterItemIndex];
    const after = items[cut.afterItemIndex + 1];
    const shortest = Math.min(
      before.outputEnd - before.outputStart,
      after.outputEnd - after.outputStart,
    );
    const maxDuration = roundTime(shortest / 2);

    return cut.transition.duration > maxDuration
      ? { ...cut, transition: { ...cut.transition, duration: maxDuration } }
      : cut;
  });

  return { items, cuts: clampedCuts, outputDuration: roundTime(output) };
}

/**
 * Convert a source time to output time, accounting for freezes. Anything at
 * or after a freeze's source time is pushed later by that freeze's duration,
 * so dialogue and subtitles starting at a freeze resume after it.
 */
export function mapSourceToOutput(config: EditConfig, sourceTime: number): number {
  let shift = 0;
  for (const freeze of resolveFreezes(config)) {
    if (freeze.sourceTime <= sourceTime + TIME_EPSILON / 2) {
      shift += freeze.duration;
    }
  }
  return roundTime(sourceTime + shift);
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Parse a stored config. Returns null (instead of throwing) for corrupt or
 * unknown-version data so a bad row can never crash the editor; the caller
 * then starts from a fresh config and the source video is unaffected.
 */
export function parseEditConfig(json: string): EditConfig | null {
  try {
    const value = JSON.parse(json) as Partial<EditConfig> | null;

    if (
      !value ||
      value.version !== 1 ||
      typeof value.sourceUri !== "string" ||
      typeof value.sourceDuration !== "number" ||
      !value.custom ||
      !Array.isArray(value.custom.transitions) ||
      !Array.isArray(value.custom.freezes) ||
      !Array.isArray(value.custom.blurs)
    ) {
      return null;
    }

    return value as EditConfig;
  } catch {
    return null;
  }
}
