// Run with: npm test
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MyDefaultPreset } from "../../types/edit.ts";
import {
  dragMarker,
  findFreeSpot,
  formatClock,
  isMarkerOverlapping,
  layoutLength,
  markerGapSeconds,
  parseClock,
  presetProblems,
  presetSpans,
  settleMarker,
  sortPreset,
} from "./presetLayout.ts";

const NOW = "2026-11-27T00:00:00.000Z";

function preset(overrides: Partial<MyDefaultPreset> = {}): MyDefaultPreset {
  return {
    version: 2,
    repeat: true,
    patternLength: 60,
    transitions: [
      { at: 10, kind: "fade", duration: 3 },
      { at: 15, kind: "dissolve", duration: 4 },
    ],
    freezes: [],
    updatedAt: NOW,
    ...overrides,
  };
}

describe("clock formatting", () => {
  it("formats and parses m:ss", () => {
    assert.equal(formatClock(130), "2:10");
    assert.equal(formatClock(65.5), "1:05.5");
    assert.equal(formatClock(0), "0:00");
    assert.equal(parseClock("0:50"), 50);
    assert.equal(parseClock("1:02:03"), 3723);
    assert.equal(parseClock("2:75"), null);
    assert.equal(parseClock("abc"), null);
  });
});

describe("layout length", () => {
  it("repeat ON uses the editable round length; OFF uses the real video length", () => {
    assert.equal(layoutLength(preset({ patternLength: 50 }), 40), 50);
    assert.equal(layoutLength(preset({ repeat: false, patternLength: 50 }), 40), 40);
    // No video known: fall back to the round length.
    assert.equal(layoutLength(preset({ repeat: false, patternLength: 50 })), 50);
  });
});

describe("free dragging (pass through other lines)", () => {
  const L = 60;
  const ref = { type: "transition" as const, index: 1 };

  it("your example: the 0:15 line passes over 0:10 and is dropped at 0:05", () => {
    const start = preset();
    const over = dragMarker(start, L, ref, 10);
    assert.equal(over.transitions[1].at, 10);
    assert.ok(isMarkerOverlapping(over, L, ref));

    const dropped = settleMarker(dragMarker(over, L, ref, 5), L, ref, start);
    assert.equal(dropped.transitions[1].at, 5);
    assert.deepEqual(presetProblems(dropped, L), []);
    // Cards renumber by time: the moved "dissolve" is now first.
    assert.equal(sortPreset(dropped).transitions[0].kind, "dissolve");
  });

  it("dropping on top of another line moves it to the nearest free spot", () => {
    const start = preset();
    const settled = settleMarker(dragMarker(start, L, ref, 10.5), L, ref, start);
    assert.deepEqual(presetProblems(settled, L), []);
    assert.ok(Math.abs(settled.transitions[1].at - 10.5) <= 1.5);
  });

  it("a freeze's whole span must land in a free gap", () => {
    const p = preset({ transitions: [{ at: 30, kind: "fade", duration: 3 }], freezes: [{ at: 10, duration: 5, zoomTo: 1.1, zoomDirection: "center" }] });
    const fref = { type: "freeze" as const, index: 0 };
    const settled = settleMarker(dragMarker(p, L, fref, 28), L, fref, p);
    assert.deepEqual(presetProblems(settled, L), []);
    const start = settled.freezes[0].at;
    const gap = markerGapSeconds(L);
    assert.ok(start + 5 <= 30 - gap + 0.001 || start >= 30 + gap - 0.001);
  });

  it("returns the previous layout when there is no free spot at all", () => {
    const tight = preset({
      patternLength: 10,
      transitions: [{ at: 5, kind: "fade", duration: 3 }],
      freezes: [{ at: 1, duration: 8, zoomTo: 1.1, zoomDirection: "center" }],
    });
    const tref = { type: "transition" as const, index: 0 };
    assert.equal(settleMarker(dragMarker(tight, 10, tref, 5), 10, tref, tight), tight);
  });

  it("snaps to half seconds and stays inside the layout", () => {
    assert.equal(dragMarker(preset(), L, ref, 30.26).transitions[1].at, 30.5);
    assert.ok(dragMarker(preset(), L, ref, 999).transitions[1].at <= L - 0.5);
  });
});

describe("adding lines and validation", () => {
  it("puts a new line in the biggest free gap without overlap", () => {
    const p = preset();
    const at = findFreeSpot(p, 60, 0)!;
    const added = { ...p, transitions: [...p.transitions, { at, kind: "fade" as const, duration: 3 }] };
    assert.deepEqual(presetProblems(added, 60), []);
  });

  it("returns null when nothing fits", () => {
    const crowded = preset({ patternLength: 12, transitions: [], freezes: [{ at: 1, duration: 8, zoomTo: 1.1, zoomDirection: "center" }] });
    assert.equal(findFreeSpot(crowded, 12, 5), null);
  });

  it("reports lines that no longer fit after shortening the round", () => {
    assert.ok(presetProblems(preset(), 12).length > 0); // 0:15 is past 0:12
  });

  it("orders spans by start", () => {
    const starts = presetSpans(preset()).map((s) => s.start);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });
});
