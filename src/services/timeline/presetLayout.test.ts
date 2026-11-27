// Run with: npm test
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MyDefaultPreset } from "../../types/edit.ts";
import {
  dragMarker,
  findFreeSpot,
  isMarkerOverlapping,
  settleMarker,
  sortPreset,
  formatClock,
  markerBounds,
  markerGapSeconds,
  moveMarker,
  parseClock,
  presetProblems,
  presetSpans,
} from "./presetLayout.ts";

const NOW = "2026-11-27T00:00:00.000Z";

function preset(overrides: Partial<MyDefaultPreset> = {}): MyDefaultPreset {
  return {
    version: 1,
    referenceDuration: 130, // 2:10
    transitions: [0.25, 0.5, 0.75].map((position) => ({ position, kind: "dissolve", duration: 0.5 })),
    freezes: [{ position: 0.1, duration: 5, zoomTo: 1.15, zoomDirection: "center" }],
    updatedAt: NOW,
    ...overrides,
  };
}

describe("clock formatting", () => {
  it("formats and parses m:ss", () => {
    assert.equal(formatClock(130), "2:10");
    assert.equal(formatClock(65.5), "1:05.5");
    assert.equal(formatClock(0), "0:00");
    assert.equal(parseClock("2:10"), 130);
    assert.equal(parseClock("1:02:03"), 3723);
    assert.equal(parseClock("95"), 95);
    assert.equal(parseClock("2:75"), null);
    assert.equal(parseClock("abc"), null);
  });
});

describe("dragging lines", () => {
  it("never lets a line cross or touch its neighbours", () => {
    const p = preset();
    const gap = markerGapSeconds(130);
    // Transition 2 (at 65 s) sits between transition 1 (32.5 s) and 3 (97.5 s).
    const { min, max } = markerBounds(p, { type: "transition", index: 1 });
    assert.ok(Math.abs(min - (32.5 + gap)) < 0.01);
    assert.ok(Math.abs(max - (97.5 - gap)) < 0.01);

    const pushedFar = moveMarker(p, { type: "transition", index: 1 }, 500);
    const pushedBack = moveMarker(p, { type: "transition", index: 1 }, -50);
    assert.ok(pushedFar.transitions[1].position * 130 <= 97.5 - gap + 0.01);
    assert.ok(pushedBack.transitions[1].position * 130 >= 32.5 + gap - 0.01);
    assert.deepEqual(presetProblems(pushedFar), []);
    assert.deepEqual(presetProblems(pushedBack), []);
  });

  it("keeps a freeze's whole span clear of other lines", () => {
    const p = preset();
    // Freeze at 13 s, 5 s long; next line is transition 1 at 32.5 s.
    const moved = moveMarker(p, { type: "freeze", index: 0 }, 40);
    const freezeEnd = moved.freezes[0].position * 130 + 5;
    assert.ok(freezeEnd <= 32.5 - markerGapSeconds(130) + 0.01);
  });

  it("snaps to half seconds", () => {
    const moved = moveMarker(preset(), { type: "transition", index: 1 }, 60.26);
    assert.ok(Math.abs(moved.transitions[1].position * 130 - 60.5) < 0.001);
  });
});

describe("adding lines", () => {
  it("puts a new line in the biggest free gap without overlap", () => {
    const p = preset();
    const at = findFreeSpot(p, 0)!;
    const added = { ...p, transitions: [...p.transitions, { position: at / 130, kind: "dissolve" as const, duration: 0.5 }] };
    assert.deepEqual(presetProblems(added), []);
  });

  it("returns null when nothing fits", () => {
    const crowded = preset({ referenceDuration: 12, freezes: [{ position: 0.1, duration: 8, zoomTo: 1.1, zoomDirection: "center" }], transitions: [] });
    assert.equal(findFreeSpot(crowded, 5), null);
  });
});

describe("validation", () => {
  it("reports overlaps after shortening the total length", () => {
    const short = preset({ referenceDuration: 20 });
    // At 20 s: freeze 2–7 s and transition at 5 s overlap.
    assert.ok(presetProblems(short).length > 0);
  });

  it("orders spans by start", () => {
    const starts = presetSpans(preset()).map((s) => s.start);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });
});

describe("free dragging (pass through other lines)", () => {
  // Your example: transition 1 at 10 s, transition 2 at 15 s, move 2 to 5 s.
  const two = (): MyDefaultPreset =>
    preset({
      referenceDuration: 60,
      transitions: [
        { position: 10 / 60, kind: "dissolve", duration: 0.5 },
        { position: 15 / 60, kind: "fade", duration: 1 },
      ],
      freezes: [],
    });
  const at = (p: MyDefaultPreset, i: number) => Math.round(p.transitions[i].position * 60 * 1000) / 1000;

  it("lets a line pass over another and stay where it is dropped", () => {
    const start = two();
    const ref = { type: "transition" as const, index: 1 };
    // Finger passes over the line at 10 s...
    const over = dragMarker(start, ref, 10);
    assert.equal(at(over, 1), 10);
    assert.ok(isMarkerOverlapping(over, ref));
    // ...and is released at 5 s: free spot, so it stays there.
    const dropped = settleMarker(dragMarker(over, ref, 5), ref, start);
    assert.equal(at(dropped, 1), 5);
    assert.deepEqual(presetProblems(dropped), []);

    // Cards renumber by time: the moved "fade" is now first.
    const sorted = sortPreset(dropped);
    assert.equal(sorted.transitions[0].kind, "fade");
  });

  it("dropping on top of another line moves it to the nearest free spot", () => {
    const start = two();
    const ref = { type: "transition" as const, index: 1 };
    const settled = settleMarker(dragMarker(start, ref, 10.5), ref, start);
    assert.deepEqual(presetProblems(settled), []);
    assert.ok(Math.abs(at(settled, 1) - 10.5) <= 1.5, `landed at ${at(settled, 1)}`);
  });

  it("freeze lines can be dragged across transitions too, without ending inside a gap that's too small", () => {
    const p = preset({
      referenceDuration: 60,
      transitions: [{ position: 30 / 60, kind: "dissolve", duration: 0.5 }],
      freezes: [{ position: 10 / 60, duration: 5, zoomTo: 1.1, zoomDirection: "center" }],
    });
    const ref = { type: "freeze" as const, index: 0 };
    // Drop the freeze so it would cover the transition at 30 s.
    const settled = settleMarker(dragMarker(p, ref, 28), ref, p);
    assert.deepEqual(presetProblems(settled), []);
    const start = settled.freezes[0].position * 60;
    assert.ok(start + 5 <= 29 + 0.001 || start >= 31 - 0.001);
  });

  it("returns the previous layout when there is no free spot at all", () => {
    const tight = preset({
      referenceDuration: 10,
      transitions: [{ position: 0.5, kind: "dissolve", duration: 0.5 }],
      freezes: [{ position: 0.1, duration: 8, zoomTo: 1.1, zoomDirection: "center" }],
    });
    const ref = { type: "transition" as const, index: 0 };
    const result = settleMarker(dragMarker(tight, ref, 5), ref, tight);
    assert.equal(result, tight);
  });
});
