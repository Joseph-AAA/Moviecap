/**
 * Layout rules for the My Default timeline editor: where each line may be
 * dragged, where a new one fits, and whether the layout is valid.
 * Pure (type-only imports) so it is unit-tested with `node --test`.
 *
 * Positions are SECONDS. The timeline shown is `layoutLength`:
 * - repeat ON:  the pattern round (user-editable Total length, e.g. 0:50)
 * - repeat OFF: the real length of the current video (not editable)
 *
 * "Lines never overlap": every line keeps at least markerGapSeconds() from
 * the next, and nothing may sit inside a freeze's span (at .. at+duration).
 * Dragging is FREE (lines can pass over each other); settleMarker moves a
 * dropped line to the nearest free spot, so the saved layout is valid.
 */

import type { MyDefaultPreset } from "@/types/edit";

export const DEFAULT_PATTERN_LENGTH = 60;
export const MIN_PATTERN_LENGTH = 5;
export const MAX_PATTERN_LENGTH = 3 * 60 * 60;
/** Lines stay at least this far from the very start/end of the layout. */
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

/** The length the timeline is laid out on (see file comment). */
export function layoutLength(preset: MyDefaultPreset, videoDuration?: number): number {
  if (preset.repeat || !videoDuration || videoDuration <= 0) return preset.patternLength;
  return videoDuration;
}

/** Minimum distance between two lines: 1 s, or 2% of long layouts. */
export function markerGapSeconds(length: number): number {
  return Math.max(1, length * 0.02);
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function sameRef(a: MarkerRef, b: MarkerRef): boolean {
  return a.type === b.type && a.index === b.index;
}

function snap(seconds: number): number {
  return Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS;
}

/** All lines as spans (seconds), sorted by start. */
export function presetSpans(preset: MyDefaultPreset): MarkerSpan[] {
  const spans: MarkerSpan[] = [
    ...preset.transitions.map((t, index) => ({
      ref: { type: "transition" as const, index },
      start: t.at,
      end: t.at,
    })),
    ...preset.freezes.map((f, index) => ({
      ref: { type: "freeze" as const, index },
      start: f.at,
      end: f.at + f.duration,
    })),
  ];
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

function spanLength(preset: MyDefaultPreset, ref: MarkerRef): number {
  return ref.type === "freeze" ? preset.freezes[ref.index].duration : 0;
}

function withAt(preset: MyDefaultPreset, ref: MarkerRef, seconds: number): MyDefaultPreset {
  const at = round(seconds);
  return ref.type === "transition"
    ? { ...preset, transitions: preset.transitions.map((t, i) => (i === ref.index ? { ...t, at } : t)) }
    : { ...preset, freezes: preset.freezes.map((f, i) => (i === ref.index ? { ...f, at } : f)) };
}

/**
 * Free drag: follow the finger anywhere inside the layout (snapped), even
 * over other lines. Call settleMarker when the finger lifts.
 */
export function dragMarker(
  preset: MyDefaultPreset,
  length: number,
  ref: MarkerRef,
  seconds: number,
): MyDefaultPreset {
  const max = length - EDGE_SECONDS - spanLength(preset, ref);
  return withAt(preset, ref, Math.min(max, Math.max(EDGE_SECONDS, snap(seconds))));
}

/** Start ranges where a line of `size` seconds fits without touching `others`. */
function freeRanges(length: number, others: MarkerSpan[], size: number): { min: number; max: number }[] {
  const gap = markerGapSeconds(length);
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const ranges: { min: number; max: number }[] = [];
  let cursorEnd = EDGE_SECONDS - gap;

  for (const span of [...sorted, { start: length - EDGE_SECONDS + gap, end: length }]) {
    const min = cursorEnd + gap;
    const max = span.start - gap - size;
    if (max >= min) ranges.push({ min, max });
    cursorEnd = Math.max(cursorEnd, span.end);
  }
  return ranges;
}

/** True when the line currently overlaps or touches another line. */
export function isMarkerOverlapping(preset: MyDefaultPreset, length: number, ref: MarkerRef): boolean {
  const spans = presetSpans(preset);
  const self = spans.find((s) => sameRef(s.ref, ref));
  if (!self) return false;
  const others = spans.filter((s) => !sameRef(s.ref, ref));
  return !freeRanges(length, others, self.end - self.start).some(
    (r) => self.start >= r.min - 0.001 && self.start <= r.max + 0.001,
  );
}

/**
 * After a free drag: keep the line where it was dropped if that spot is
 * free; otherwise move it to the NEAREST free spot. If nothing is free,
 * return `fallback` (the layout before the drag).
 */
export function settleMarker(
  preset: MyDefaultPreset,
  length: number,
  ref: MarkerRef,
  fallback: MyDefaultPreset,
): MyDefaultPreset {
  const spans = presetSpans(preset);
  const self = spans.find((s) => sameRef(s.ref, ref));
  if (!self) return preset;

  const others = spans.filter((s) => !sameRef(s.ref, ref));
  const ranges = freeRanges(length, others, self.end - self.start);
  if (ranges.length === 0) return fallback;

  let best = Number.NaN;
  let bestDistance = Infinity;
  for (const range of ranges) {
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
  return withAt(preset, ref, best);
}

/** Order transitions and freezes by time, so card numbers follow the timeline. */
export function sortPreset(preset: MyDefaultPreset): MyDefaultPreset {
  return {
    ...preset,
    transitions: [...preset.transitions].sort((a, b) => a.at - b.at),
    freezes: [...preset.freezes].sort((a, b) => a.at - b.at),
  };
}

/**
 * Where a new line of `size` seconds (0 for a transition) can go: the
 * middle of the biggest free gap, or null if nothing fits.
 */
export function findFreeSpot(preset: MyDefaultPreset, length: number, size: number): number | null {
  const ranges = freeRanges(length, presetSpans(preset), size);
  if (ranges.length === 0) return null;
  const biggest = ranges.reduce((a, b) => (b.max - b.min > a.max - a.min ? b : a));
  const middle = snap((biggest.min + biggest.max) / 2);
  return round(Math.min(biggest.max, Math.max(biggest.min, middle)));
}

/**
 * Human-readable problems that block saving (e.g. after shortening the
 * total length or making a freeze longer). Empty when the layout is valid.
 */
export function presetProblems(preset: MyDefaultPreset, length: number): string[] {
  const gap = markerGapSeconds(length);
  const spans = presetSpans(preset);
  const problems: string[] = [];
  const name = (s: MarkerSpan) => `${s.ref.type === "freeze" ? "Freeze" : "Transition"} ${s.ref.index + 1}`;

  spans.forEach((span, i) => {
    if (span.start < EDGE_SECONDS - 0.001 || span.end > length - EDGE_SECONDS + 0.001) {
      problems.push(`${name(span)} doesn't fit inside ${formatClock(length)}.`);
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
