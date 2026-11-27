/**
 * Layout rules for the My Default timeline editor: where each line may be
 * dragged, where a new one fits, and whether the layout is valid.
 * Pure (type-only imports) so it is unit-tested with `node --test`.
 *
 * The editor shows the preset on a reference length (e.g. 2:10). Positions
 * are stored as fractions of that length, so the same preset scales to any
 * video. "Lines never overlap" means: every line keeps at least
 * markerGapSeconds() away from the next one, and nothing may sit inside a
 * freeze's span (start .. start + duration).
 *
 * Dragging is FREE: a line may pass over other lines while the finger is
 * down (dragMarker). When released, settleMarker moves it to the nearest
 * position that doesn't overlap, so the saved layout is always valid.
 */

import type { MyDefaultPreset } from "@/types/edit";

export const DEFAULT_REFERENCE_DURATION = 120;
export const MIN_REFERENCE_DURATION = 10;
export const MAX_REFERENCE_DURATION = 3 * 60 * 60;
export const PRESET_TRANSITION_DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3] as const;
/** Lines stay at least this far from the very start/end. */
export const EDGE_SECONDS = 0.5;
/** Dragged positions snap to this step. */
export const SNAP_SECONDS = 0.5;

export type MarkerType = "transition" | "freeze";

export interface MarkerRef {
  type: MarkerType;
  index: number;
}

export interface MarkerSpan {
  ref: MarkerRef;
  start: number;
  /** Equal to start for a transition; start + duration for a freeze. */
  end: number;
}

export function referenceDuration(preset: MyDefaultPreset): number {
  return preset.referenceDuration ?? DEFAULT_REFERENCE_DURATION;
}

/** Minimum distance between two lines: 1 s, or 2% of long references. */
export function markerGapSeconds(reference: number): number {
  return Math.max(1, reference * 0.02);
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function sameRef(a: MarkerRef, b: MarkerRef): boolean {
  return a.type === b.type && a.index === b.index;
}

/** All lines as spans in seconds on the reference length, sorted by start. */
export function presetSpans(preset: MyDefaultPreset): MarkerSpan[] {
  const reference = referenceDuration(preset);
  const spans: MarkerSpan[] = [
    ...preset.transitions.map((t, index) => ({
      ref: { type: "transition" as const, index },
      start: t.position * reference,
      end: t.position * reference,
    })),
    ...preset.freezes.map((f, index) => ({
      ref: { type: "freeze" as const, index },
      start: f.position * reference,
      end: f.position * reference + f.duration,
    })),
  ];
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

function spanLength(preset: MyDefaultPreset, ref: MarkerRef): number {
  return ref.type === "freeze" ? preset.freezes[ref.index].duration : 0;
}

/**
 * The range (seconds) the line's START can move within without crossing or
 * touching its neighbours. Lines keep their order, so dragging can never
 * create an overlap.
 */
export function markerBounds(
  preset: MyDefaultPreset,
  ref: MarkerRef,
): { min: number; max: number } {
  const reference = referenceDuration(preset);
  const gap = markerGapSeconds(reference);
  const spans = presetSpans(preset);
  const selfIndex = spans.findIndex((s) => sameRef(s.ref, ref));
  const prev = selfIndex > 0 ? spans[selfIndex - 1] : null;
  const next = selfIndex < spans.length - 1 ? spans[selfIndex + 1] : null;
  const length = spanLength(preset, ref);

  const min = prev ? prev.end + gap : EDGE_SECONDS;
  const max = (next ? next.start - gap : reference - EDGE_SECONDS) - length;
  return { min: round(min), max: round(Math.max(min, max)) };
}

/** Move a line to `seconds` (snapped and kept inside its bounds). */
export function moveMarker(
  preset: MyDefaultPreset,
  ref: MarkerRef,
  seconds: number,
): MyDefaultPreset {
  const reference = referenceDuration(preset);
  const { min, max } = markerBounds(preset, ref);
  const snapped = Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS;
  const clamped = Math.min(max, Math.max(min, snapped));
  // 6 decimals: precise to milliseconds even on a 3-hour reference.
  const position = Math.round((clamped / reference) * 1e6) / 1e6;

  return ref.type === "transition"
    ? {
        ...preset,
        transitions: preset.transitions.map((t, i) => (i === ref.index ? { ...t, position } : t)),
      }
    : {
        ...preset,
        freezes: preset.freezes.map((f, i) => (i === ref.index ? { ...f, position } : f)),
      };
}

function withPosition(preset: MyDefaultPreset, ref: MarkerRef, seconds: number): MyDefaultPreset {
  const reference = referenceDuration(preset);
  // 6 decimals: precise to milliseconds even on a 3-hour reference.
  const position = Math.round((seconds / reference) * 1e6) / 1e6;
  return ref.type === "transition"
    ? {
        ...preset,
        transitions: preset.transitions.map((t, i) => (i === ref.index ? { ...t, position } : t)),
      }
    : {
        ...preset,
        freezes: preset.freezes.map((f, i) => (i === ref.index ? { ...f, position } : f)),
      };
}

function snap(seconds: number): number {
  return Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS;
}

/**
 * Free drag: follow the finger anywhere inside the video (snapped), even
 * over other lines. Call settleMarker when the finger lifts.
 */
export function dragMarker(
  preset: MyDefaultPreset,
  ref: MarkerRef,
  seconds: number,
): MyDefaultPreset {
  const reference = referenceDuration(preset);
  const max = reference - EDGE_SECONDS - spanLength(preset, ref);
  return withPosition(preset, ref, Math.min(max, Math.max(EDGE_SECONDS, snap(seconds))));
}

/** Start ranges where a line of `length` fits without touching `others`. */
function freeRanges(
  reference: number,
  others: MarkerSpan[],
  length: number,
): { min: number; max: number }[] {
  const gap = markerGapSeconds(reference);
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const ranges: { min: number; max: number }[] = [];
  let cursorEnd = EDGE_SECONDS - gap;

  for (const span of [...sorted, { start: reference - EDGE_SECONDS + gap, end: reference }]) {
    const min = cursorEnd + gap;
    const max = span.start - gap - length;
    if (max >= min) ranges.push({ min, max });
    cursorEnd = Math.max(cursorEnd, span.end);
  }
  return ranges;
}

/** True when the line currently overlaps or touches another line. */
export function isMarkerOverlapping(preset: MyDefaultPreset, ref: MarkerRef): boolean {
  const reference = referenceDuration(preset);
  const spans = presetSpans(preset);
  const self = spans.find((s) => sameRef(s.ref, ref));
  if (!self) return false;
  const others = spans.filter((s) => !sameRef(s.ref, ref));
  return !freeRanges(reference, others, self.end - self.start).some(
    (r) => self.start >= r.min - 0.001 && self.start <= r.max + 0.001,
  );
}

/**
 * After a free drag: keep the line where it was dropped if that spot is
 * free; otherwise move it to the NEAREST free spot. If there is no free spot
 * at all, return `fallback` (the layout before the drag).
 */
export function settleMarker(
  preset: MyDefaultPreset,
  ref: MarkerRef,
  fallback: MyDefaultPreset,
): MyDefaultPreset {
  const reference = referenceDuration(preset);
  const spans = presetSpans(preset);
  const self = spans.find((s) => sameRef(s.ref, ref));
  if (!self) return preset;

  const others = spans.filter((s) => !sameRef(s.ref, ref));
  const ranges = freeRanges(reference, others, self.end - self.start);
  if (ranges.length === 0) return fallback;

  let best = Number.NaN;
  let bestDistance = Infinity;
  for (const range of ranges) {
    // Snap inside the range (round up at its start, down at its end).
    const lo = Math.ceil(range.min / SNAP_SECONDS - 1e-9) * SNAP_SECONDS;
    const hi = Math.floor(range.max / SNAP_SECONDS + 1e-9) * SNAP_SECONDS;
    const candidates = hi >= lo ? [lo, hi] : [range.min];
    const inside = Math.min(hi >= lo ? hi : range.max, Math.max(hi >= lo ? lo : range.min, snap(self.start)));
    for (const candidate of [...candidates, inside]) {
      const distance = Math.abs(candidate - self.start);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }

  return withPosition(preset, ref, best);
}

/** Order transitions and freezes by time, so card numbers follow the timeline. */
export function sortPreset(preset: MyDefaultPreset): MyDefaultPreset {
  return {
    ...preset,
    transitions: [...preset.transitions].sort((a, b) => a.position - b.position),
    freezes: [...preset.freezes].sort((a, b) => a.position - b.position),
  };
}

/**
 * Where a new line of `length` seconds (0 for a transition) can go: the
 * middle of the biggest free gap, or null if nothing fits.
 */
export function findFreeSpot(preset: MyDefaultPreset, length: number): number | null {
  const reference = referenceDuration(preset);
  const gap = markerGapSeconds(reference);
  const spans = presetSpans(preset);

  let best: { start: number; room: number } | null = null;
  let cursor = EDGE_SECONDS - gap; // so the first free gap starts at EDGE_SECONDS

  for (const span of [...spans, { start: reference - EDGE_SECONDS + gap, end: reference }]) {
    const freeStart = cursor + gap;
    const freeEnd = span.start - gap - length;
    const room = freeEnd - freeStart;
    if (room >= 0 && (!best || room > best.room)) best = { start: freeStart, room };
    cursor = Math.max(cursor, span.end);
  }

  if (!best) return null;
  const middle = best.start + best.room / 2;
  return round(Math.round(middle / SNAP_SECONDS) * SNAP_SECONDS);
}

/**
 * Human-readable problems that block saving (e.g. after shortening the
 * total length or making a freeze longer). Empty when the layout is valid.
 */
export function presetProblems(preset: MyDefaultPreset): string[] {
  const reference = referenceDuration(preset);
  const gap = markerGapSeconds(reference);
  const spans = presetSpans(preset);
  const problems: string[] = [];
  const name = (s: MarkerSpan) =>
    `${s.ref.type === "freeze" ? "Freeze" : "Transition"} ${s.ref.index + 1}`;

  spans.forEach((span, i) => {
    if (span.start < EDGE_SECONDS - 0.001 || span.end > reference - EDGE_SECONDS + 0.001) {
      problems.push(`${name(span)} doesn't fit inside ${formatClock(reference)}.`);
    }
    const next = spans[i + 1];
    if (next && next.start - span.end < gap - 0.001) {
      problems.push(`${name(span)} and ${name(next)} are too close or overlap.`);
    }
  });
  return problems;
}

/** 130 -> "2:10", 5.5 -> "0:05.5" */
export function formatClock(seconds: number): string {
  const whole = Math.floor(seconds + 1e-6);
  const fraction = seconds - whole;
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  const tenths = fraction >= 0.05 ? `.${Math.round(fraction * 10) % 10}` : "";
  return `${minutes}:${rest}${tenths}`;
}

/** "2:10" -> 130, "1:02:03" -> 3723, "95" -> 95; null if invalid. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((n) => n >= 60)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}
