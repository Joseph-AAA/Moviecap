/**
 * Pure editing-timeline logic (no React, no native modules, no runtime
 * imports) so it can be unit-tested with `node --test`.
 *
 * Timing model (decided with the user, 2026-11-27):
 * - Freeze frames REPLACE video. A 5 s freeze at source time t shows the
 *   frame at t (with a slow zoom) from t to t+5; the original frames in that
 *   stretch are dropped. The ORIGINAL AUDIO KEEPS PLAYING underneath, so the
 *   output is exactly as long as the source and output time == source time.
 *   Dialogue, subtitles and dubbing never need re-timing.
 * - Transitions do NOT change the output length and do not drop frames: the
 *   renderer holds the outgoing item's last frame for the transition length
 *   while it dissolves into the incoming item.
 * - Leaving a freeze always dissolves back to live video (the picture would
 *   otherwise jump from the zoomed still), unless a transition is set there.
 * - Segments are contiguous and in source order; they cover the whole video.
 */

import type {
  DefaultEdit,
  EditConfig,
  FreezeEffect,
  MyDefaultPreset,
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
/** Default freezes keep at least this far from cuts and from the video ends. */
export const FREEZE_EDGE_MARGIN = 2;
/** Minimum gap between two default freezes. */
export const FREEZE_MIN_GAP = 1;
/** Shorter freezes (after clamping to the video end) are dropped. */
export const MIN_FREEZE_DURATION = 0.5;
/** Dissolve used when a freeze hands back to live video. */
export const FREEZE_EXIT_TRANSITION_DURATION = 0.4;
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

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < TIME_EPSILON;
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
 * Pick 2 or 3 freeze moments. Each freeze covers [t, t + duration], and that
 * whole stretch (plus FREEZE_EDGE_MARGIN) must stay clear of cuts and of the
 * video's start/end. Valid start times are spread into equal zones and one
 * moment is chosen in the middle of each zone, never overlapping the
 * previous freeze. Fewer freezes are returned when the video is too short.
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
  const length = DEFAULT_FREEZE_DURATION;
  const step = 0.1;

  // All valid start times on a 0.1 s grid.
  const candidates: number[] = [];
  for (let t = FREEZE_EDGE_MARGIN; t + length <= duration - FREEZE_EDGE_MARGIN; t += step) {
    const blocked = cutTimes.some(
      (cut) => cut > t - FREEZE_EDGE_MARGIN && cut < t + length + FREEZE_EDGE_MARGIN,
    );
    if (!blocked) candidates.push(roundTime(t));
  }

  const count = random() < 0.5 ? 2 : 3;
  const freezes: FreezeEffect[] = [];
  let earliest = 0;

  for (let zone = 0; zone < count; zone++) {
    const zoneStart = Math.floor((zone * candidates.length) / count);
    const zoneEnd = Math.floor(((zone + 1) * candidates.length) / count);
    const pool = candidates
      .slice(zoneStart, zoneEnd)
      .filter((t) => t >= earliest);

    if (pool.length === 0) continue;

    // Middle 60% of the zone keeps freezes well spread.
    const lo = Math.floor(pool.length * 0.2);
    const hi = Math.max(lo + 1, Math.ceil(pool.length * 0.8));
    const chosen = pool[lo + Math.floor(random() * (hi - lo))];

    freezes.push({
      id: makeId("frz", zone, seed),
      origin: "default",
      sourceTime: chosen,
      duration: length,
      zoomFrom: 1,
      zoomTo: DEFAULT_FREEZE_ZOOM_TO,
      zoomDirection: "center",
    });
    earliest = chosen + length + FREEZE_MIN_GAP;
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
    source: "standard",
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

/** True when the edit changes the picture (default or custom effects). */
export function hasEditEffects(config: EditConfig): boolean {
  return (
    config.defaultEdit !== null ||
    config.custom.transitions.length > 0 ||
    config.custom.freezes.length > 0 ||
    config.custom.blurs.length > 0
  );
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

/**
 * Freezes that take effect, in source order, clamped to the video end.
 * Freezes never overlap: if two would, the EARLIER one wins and the later
 * one is skipped (it stays stored, so editing the first can bring it back).
 */
export function resolveFreezes(config: EditConfig): FreezeEffect[] {
  const all = [...(config.defaultEdit?.freezes ?? []), ...config.custom.freezes]
    .filter((f) => f.sourceTime >= 0 && f.sourceTime < config.sourceDuration)
    .map((f) => ({
      ...f,
      duration: roundTime(Math.min(f.duration, config.sourceDuration - f.sourceTime)),
    }))
    .filter((f) => f.duration >= MIN_FREEZE_DURATION)
    .sort((a, b) => a.sourceTime - b.sourceTime);

  const resolved: FreezeEffect[] = [];
  for (const freeze of all) {
    const previous = resolved.at(-1);
    if (previous && freeze.sourceTime < previous.sourceTime + previous.duration - TIME_EPSILON) {
      continue;
    }
    resolved.push(freeze);
  }
  return resolved;
}

function insideFreeze(time: number, freezes: FreezeEffect[]): boolean {
  return freezes.some(
    (f) => time > f.sourceTime + TIME_EPSILON && time < f.sourceTime + f.duration - TIME_EPSILON,
  );
}

/**
 * Transitions that take effect, one per cut point.
 * - A custom and a default transition at the same cut: the CUSTOM one wins.
 *   The default stays stored, so removing the custom one brings it back.
 * - Transitions inside a freeze are skipped (the picture is a still there).
 */
export function resolveTransitions(config: EditConfig): TransitionEffect[] {
  const freezes = resolveFreezes(config);
  const resolved = [...config.custom.transitions];

  for (const def of config.defaultEdit?.transitions ?? []) {
    if (!resolved.some((custom) => sameTime(custom.at, def.at))) {
      resolved.push(def);
    }
  }

  return resolved
    .filter(
      (t) =>
        t.at > TIME_EPSILON &&
        t.at < config.sourceDuration - TIME_EPSILON &&
        !insideFreeze(t.at, freezes),
    )
    .sort((a, b) => a.at - b.at);
}

/**
 * Turn the stored config into the exact sequence the renderer and the
 * preview follow: clips and freezes in output order, the cuts between them,
 * and the final output duration (always equal to the source duration).
 *
 * Cut rules:
 * - Cuts come from default segment boundaries, custom transition points and
 *   freeze start/end points. Cuts inside a freeze disappear.
 * - Entering a freeze is seamless (same frame) unless a transition is set.
 * - Leaving a freeze dissolves back to live video unless a transition is set.
 * - A transition never lasts longer than half of the shorter item around it.
 */
export function buildTimeline(config: EditConfig): Timeline {
  const duration = config.sourceDuration;
  const transitions = resolveTransitions(config);
  const freezes = resolveFreezes(config);

  const splitTimes = new Set<number>();
  for (const segment of config.defaultEdit?.segments ?? []) {
    splitTimes.add(segment.start);
  }
  for (const t of transitions) splitTimes.add(t.at);
  for (const f of freezes) {
    splitTimes.add(f.sourceTime);
    splitTimes.add(f.sourceTime + f.duration);
  }

  const points = [...splitTimes]
    .filter((t) => t > TIME_EPSILON && t < duration - TIME_EPSILON && !insideFreeze(t, freezes))
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || !sameTime(t, all[i - 1]));

  const boundaries = [0, ...points, duration];
  const items: TimelineItem[] = [];
  const cuts: TimelineCut[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end - start <= TIME_EPSILON) continue;

    const freeze = freezes.find((f) => sameTime(f.sourceTime, start));
    const previous = items.at(-1);

    if (previous) {
      const explicit = transitions.find((t) => sameTime(t.at, start)) ?? null;
      const exitDissolve: TransitionEffect | null =
        previous.type === "freeze" && !explicit
          ? {
              id: `${previous.freeze.id}-exit`,
              origin: previous.freeze.origin,
              at: start,
              kind: "dissolve",
              duration: FREEZE_EXIT_TRANSITION_DURATION,
            }
          : null;

      cuts.push({
        sourceTime: start,
        afterItemIndex: items.length - 1,
        transition: explicit ?? exitDissolve,
      });
    }

    if (freeze) {
      const freezeEnd = Math.min(duration, freeze.sourceTime + freeze.duration);
      items.push({
        type: "freeze",
        freeze,
        sourceStart: roundTime(freeze.sourceTime),
        sourceEnd: roundTime(freezeEnd),
        outputStart: roundTime(freeze.sourceTime),
        outputEnd: roundTime(freezeEnd),
      });
    } else {
      items.push({
        type: "clip",
        sourceStart: roundTime(start),
        sourceEnd: roundTime(end),
        outputStart: roundTime(start),
        outputEnd: roundTime(end),
      });
    }
  }

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

  return { items, cuts: clampedCuts, outputDuration: roundTime(duration) };
}

/**
 * Keep only the part of a resolved timeline between source times `start`
 * and `end` (the trim selection), with output time starting at 0.
 * - Items are cut at the range edges; pieces shorter than TIME_EPSILON drop.
 * - A freeze cut by the range keeps its still frame and continues its zoom
 *   from where it would be at the range start.
 * - Cuts at or outside the range edges are dropped; transitions are
 *   re-clamped to the shorter items.
 */
export function cropTimeline(timeline: Timeline, start: number, end: number): Timeline {
  const from = Math.max(0, start);
  const to = Math.min(timeline.outputDuration, end);
  if (to - from <= TIME_EPSILON) return { items: [], cuts: [], outputDuration: 0 };

  const keptIndex = new Map<number, number>();
  const items: TimelineItem[] = [];

  timeline.items.forEach((item, index) => {
    const s = Math.max(item.sourceStart, from);
    const e = Math.min(item.sourceEnd, to);
    if (e - s <= TIME_EPSILON) return;

    const outputStart = roundTime(s - from);
    const outputEnd = roundTime(e - from);
    keptIndex.set(index, items.length);

    if (item.type === "clip") {
      items.push({ ...item, sourceStart: roundTime(s), sourceEnd: roundTime(e), outputStart, outputEnd });
      return;
    }

    // Continue the zoom from where it would be at the cut points.
    const full = item.sourceEnd - item.sourceStart;
    const zoomAt = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - item.sourceStart) / full));
      const eased = p * p * (3 - 2 * p);
      return item.freeze.zoomFrom + (item.freeze.zoomTo - item.freeze.zoomFrom) * eased;
    };

    items.push({
      ...item,
      freeze: {
        ...item.freeze,
        zoomFrom: Math.round(zoomAt(s) * 1000) / 1000,
        zoomTo: Math.round(zoomAt(e) * 1000) / 1000,
      },
      sourceStart: roundTime(s),
      sourceEnd: roundTime(e),
      outputStart,
      outputEnd,
    });
  });

  const cuts: TimelineCut[] = timeline.cuts.flatMap((cut) => {
    const before = keptIndex.get(cut.afterItemIndex);
    const after = keptIndex.get(cut.afterItemIndex + 1);
    if (before === undefined || after === undefined) return [];
    if (!cut.transition) return [{ ...cut, afterItemIndex: before }];

    const shortest = Math.min(
      items[before].outputEnd - items[before].outputStart,
      items[after].outputEnd - items[after].outputStart,
    );
    const duration = Math.min(cut.transition.duration, roundTime(shortest / 2));
    return [{ ...cut, afterItemIndex: before, transition: { ...cut.transition, duration } }];
  });

  return { items, cuts, outputDuration: roundTime(to - from) };
}

/**
 * Convert a source time to output time. Freezes replace video and audio
 * keeps playing, so this is the identity; it exists so dubbing/subtitle code
 * has one place to change if the timing model ever changes again.
 */
export function mapSourceToOutput(_config: EditConfig, sourceTime: number): number {
  return roundTime(sourceTime);
}

// ---------------------------------------------------------------------------
// Custom transitions (Phase 8)
// ---------------------------------------------------------------------------

export const CUSTOM_TRANSITION_DURATIONS = [0.2, 0.4, 0.6, 0.8, 1] as const;
/** New cuts must be at least this far from the video's start and end. */
export const MIN_CUT_EDGE_DISTANCE = 0.5;

export type TransitionSlotSource = "default" | "custom" | "freeze-exit" | "none";

/** One editable cut in the timeline, for the Transitions list. */
export interface TransitionSlot {
  at: number;
  /** What plays here now (null = hard cut). */
  effective: TransitionEffect | null;
  source: TransitionSlotSource;
  /** The default transition here, if any (shown again after a reset). */
  defaultTransition: TransitionEffect | null;
}

/** Every cut in the resolved timeline, in order, with what plays there. */
export function listTransitionSlots(config: EditConfig): TransitionSlot[] {
  const timeline = buildTimeline(config);

  return timeline.cuts.map((cut) => {
    const custom = config.custom.transitions.find((t) => sameTime(t.at, cut.sourceTime)) ?? null;
    const def =
      config.defaultEdit?.transitions.find((t) => sameTime(t.at, cut.sourceTime)) ?? null;

    let source: TransitionSlotSource = "none";
    if (custom && cut.transition) source = "custom";
    else if (def && cut.transition) source = "default";
    else if (cut.transition) source = "freeze-exit";

    return {
      at: cut.sourceTime,
      effective: cut.transition,
      source,
      defaultTransition: def,
    };
  });
}

/**
 * Why a new cut can't go at `at`, or null if it can. Cuts inside a freeze
 * or too close to the video's ends are refused.
 */
export function cutPlacementProblem(config: EditConfig, at: number): string | null {
  if (at < MIN_CUT_EDGE_DISTANCE || at > config.sourceDuration - MIN_CUT_EDGE_DISTANCE) {
    return "Move the playhead away from the very start or end of the video.";
  }
  if (insideFreeze(at, resolveFreezes(config))) {
    return "This point is inside a freeze frame. Move the playhead outside the freeze.";
  }
  return null;
}

/**
 * Add or replace the CUSTOM transition at `at`. Default transitions are
 * never modified, so Unapply Default and "Reset to default" stay exact.
 */
export function setCustomTransition(
  config: EditConfig,
  at: number,
  kind: TransitionEffect["kind"],
  duration: number,
  now: Date = new Date(),
): EditConfig {
  const time = roundTime(at);
  const others = config.custom.transitions.filter((t) => !sameTime(t.at, time));
  const transition: TransitionEffect = {
    id: `trn-custom-${now.getTime().toString(36)}`,
    origin: "custom",
    at: time,
    kind,
    duration: roundTime(duration),
  };

  return {
    ...config,
    custom: {
      ...config.custom,
      transitions: [...others, transition].sort((a, b) => a.at - b.at),
    },
    updatedAt: now.toISOString(),
  };
}

/** Remove the custom transition at `at`; a default one there comes back. */
export function removeCustomTransition(
  config: EditConfig,
  at: number,
  now: Date = new Date(),
): EditConfig {
  return {
    ...config,
    custom: {
      ...config.custom,
      transitions: config.custom.transitions.filter((t) => !sameTime(t.at, at)),
    },
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// My Default (the user's reusable preset; positions are fractions 0..1)
// ---------------------------------------------------------------------------

export const PRESET_FREEZE_DURATIONS = [1, 2, 3, 5, 8, 10] as const;
export const PRESET_ZOOM_LEVELS = [1, 1.05, 1.1, 1.15, 1.2, 1.3] as const;

/** A sensible starting point the first time the user opens My Default. */
export function createStarterPreset(now: Date = new Date()): MyDefaultPreset {
  return {
    version: 1,
    referenceDuration: 120,
    transitions: [0.25, 0.5, 0.75].map((position) => ({
      position,
      kind: "dissolve" as const,
      duration: 0.5,
    })),
    freezes: [0.15, 0.6].map((position) => ({
      position,
      duration: DEFAULT_FREEZE_DURATION,
      zoomTo: DEFAULT_FREEZE_ZOOM_TO,
      zoomDirection: "center" as const,
    })),
    updatedAt: now.toISOString(),
  };
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Turn the preset into a concrete DefaultEdit for a video of `duration`
 * seconds. Cuts closer than MIN_CUT_EDGE_DISTANCE to the ends are dropped,
 * and freezes are clamped so they end inside the video. Conflicts follow
 * the normal timeline rules (overlapping freeze skipped, transition inside a
 * freeze skipped), so the result is always valid.
 */
export function generateFromPreset(
  duration: number,
  preset: MyDefaultPreset,
  now: Date = new Date(),
): DefaultEdit {
  const cutTimes = preset.transitions
    .map((t) => ({ ...t, at: roundTime(clampFraction(t.position) * duration) }))
    .filter((t) => t.at >= MIN_CUT_EDGE_DISTANCE && t.at <= duration - MIN_CUT_EDGE_DISTANCE)
    .sort((a, b) => a.at - b.at)
    .filter((t, i, all) => i === 0 || !sameTime(t.at, all[i - 1].at));

  const boundaries = [0, ...cutTimes.map((t) => t.at), roundTime(duration)];
  const segments: Segment[] = boundaries.slice(0, -1).map((start, i) => ({
    id: `seg-mine-${i}`,
    start,
    end: boundaries[i + 1],
  }));

  const transitions: TransitionEffect[] = cutTimes.map((t, i) => ({
    id: `trn-mine-${i}`,
    origin: "default",
    at: t.at,
    kind: t.kind,
    duration: t.duration,
  }));

  const freezes: FreezeEffect[] = preset.freezes.flatMap((f, i) => {
    const length = Math.min(f.duration, duration);
    const start = roundTime(
      Math.min(clampFraction(f.position) * duration, duration - length),
    );
    if (length < MIN_FREEZE_DURATION || start < 0) return [];
    return [
      {
        id: `frz-mine-${i}`,
        origin: "default" as const,
        sourceTime: start,
        duration: roundTime(length),
        zoomFrom: 1,
        zoomTo: f.zoomTo,
        zoomDirection: f.zoomDirection,
      },
    ];
  });

  return {
    source: "mine",
    seed: 0,
    generatedAt: now.toISOString(),
    segments,
    transitions,
    freezes,
  };
}

/** Apply My Default (replacing any active default; custom effects stay). */
export function applyMyDefault(
  config: EditConfig,
  preset: MyDefaultPreset,
  now: Date = new Date(),
): EditConfig {
  return {
    ...config,
    defaultEdit: generateFromPreset(config.sourceDuration, preset, now),
    updatedAt: now.toISOString(),
  };
}

/**
 * Capture what plays in this video now (default + custom transitions and
 * freezes) as a preset, with positions as fractions of its length.
 * Automatic freeze-exit dissolves are not saved; they are re-created.
 */
export function presetFromConfig(
  config: EditConfig,
  now: Date = new Date(),
): MyDefaultPreset {
  const duration = config.sourceDuration;
  const toFraction = (t: number) => Math.round((t / duration) * 1e6) / 1e6;

  return {
    version: 1,
    referenceDuration: roundTime(duration),
    transitions: listTransitionSlots(config)
      .filter((slot) => slot.effective && slot.source !== "freeze-exit")
      .map((slot) => ({
        position: toFraction(slot.at),
        kind: slot.effective!.kind,
        duration: slot.effective!.duration,
      })),
    freezes: resolveFreezes(config).map((f) => ({
      position: toFraction(f.sourceTime),
      duration: f.duration,
      zoomTo: f.zoomTo,
      zoomDirection: f.zoomDirection,
    })),
    updatedAt: now.toISOString(),
  };
}

/** Parse a stored preset; null for corrupt/unknown data (never crashes). */
export function parseMyDefaultPreset(json: string): MyDefaultPreset | null {
  try {
    const value = JSON.parse(json) as Partial<MyDefaultPreset> | null;
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.transitions) ||
      !Array.isArray(value.freezes)
    ) {
      return null;
    }
    return value as MyDefaultPreset;
  } catch {
    return null;
  }
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
