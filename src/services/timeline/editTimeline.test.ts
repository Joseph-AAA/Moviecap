// Run with: npm test   (uses Node's built-in test runner, no extra packages)
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EditConfig, TransitionEffect } from "../../types/edit.ts";
import {
  DEFAULT_FREEZE_DURATION,
  DEFAULT_SEGMENT_DURATIONS,
  FREEZE_EDGE_MARGIN,
  MIN_FINAL_SEGMENT,
  applyDefaultEdit,
  buildTimeline,
  createEmptyEditConfig,
  createRandom,
  generateDefaultEdit,
  generateSegments,
  mapSourceToOutput,
  parseEditConfig,
  resolveTransitions,
  unapplyDefaultEdit,
} from "./editTimeline.ts";

const NOW = new Date("2026-11-27T00:00:00.000Z");
const ALLOWED = new Set<number>(DEFAULT_SEGMENT_DURATIONS);

function config(duration: number): EditConfig {
  return createEmptyEditConfig("file:///video.mp4", duration, NOW);
}

describe("generateSegments", () => {
  it("covers the whole video contiguously, in order, for many seeds and lengths", () => {
    for (const duration of [0.8, 7, 15, 19.5, 23, 48, 61.3, 125, 600, 5400]) {
      for (let seed = 1; seed <= 50; seed++) {
        const segments = generateSegments(duration, createRandom(seed), seed);

        assert.equal(segments[0].start, 0);
        assert.equal(segments.at(-1)!.end, Math.round(duration * 1000) / 1000);

        segments.forEach((segment, i) => {
          assert.ok(segment.end > segment.start, "no empty segment");
          if (i > 0) assert.equal(segment.start, segments[i - 1].end, "contiguous");
        });

        // Every segment except the last uses one of the allowed durations.
        segments.slice(0, -1).forEach((segment) => {
          assert.ok(ALLOWED.has(Math.round(segment.end - segment.start)));
        });

        // The last piece is never tiny unless the whole video is tiny.
        if (segments.length > 1) {
          const last = segments.at(-1)!;
          assert.ok(last.end - last.start >= MIN_FINAL_SEGMENT);
        }
      }
    }
  });

  it("uses different durations across seeds (it is actually random)", () => {
    const firstDurations = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const [first] = generateSegments(600, createRandom(seed), seed);
      firstDurations.add(first.end - first.start);
    }
    assert.ok(firstDurations.size >= 3);
  });
});

describe("generateDefaultEdit", () => {
  it("is reproducible from its seed", () => {
    assert.deepEqual(
      generateDefaultEdit(300, 1234, NOW),
      generateDefaultEdit(300, 1234, NOW),
    );
  });

  it("puts one subtle transition at every segment boundary", () => {
    const edit = generateDefaultEdit(300, 99, NOW);
    assert.equal(edit.transitions.length, edit.segments.length - 1);
    edit.transitions.forEach((t, i) => {
      assert.equal(t.at, edit.segments[i + 1].start);
      assert.equal(t.kind, "dissolve");
      assert.ok(t.duration > 0 && t.duration <= 0.5);
    });
  });

  it("creates 2 or 3 five-second zoom freezes, away from cuts and video edges", () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const edit = generateDefaultEdit(300, seed, NOW);
      counts.add(edit.freezes.length);

      for (const freeze of edit.freezes) {
        assert.equal(freeze.duration, DEFAULT_FREEZE_DURATION);
        assert.ok(freeze.zoomTo > freeze.zoomFrom && freeze.zoomTo <= 1.3);
        assert.ok(freeze.sourceTime >= FREEZE_EDGE_MARGIN);
        assert.ok(freeze.sourceTime <= 300 - FREEZE_EDGE_MARGIN);
      }
    }
    assert.deepEqual([...counts].sort(), [2, 3]);
  });

  it("adds no freezes to a video too short for them", () => {
    assert.equal(generateDefaultEdit(3, 7, NOW).freezes.length, 0);
  });
});

describe("Apply / Unapply Default", () => {
  it("refuses to stack a second Default Edit unless regenerating", () => {
    const applied = applyDefaultEdit(config(120), { seed: 1, now: NOW });
    assert.throws(() => applyDefaultEdit(applied, { seed: 2, now: NOW }));

    const regenerated = applyDefaultEdit(applied, { seed: 2, regenerate: true, now: NOW });
    assert.equal(regenerated.defaultEdit!.seed, 2);
  });

  it("Unapply removes only default effects and keeps custom ones", () => {
    const custom: TransitionEffect = {
      id: "c1",
      origin: "custom",
      at: 40,
      kind: "fade",
      duration: 0.5,
    };
    const base = config(120);
    const withCustom: EditConfig = {
      ...base,
      custom: {
        transitions: [custom],
        freezes: [],
        blurs: [
          { id: "b1", start: 0, end: 10, x: 0.1, y: 0.8, width: 0.8, height: 0.1, intensity: 6, shape: "rectangle" },
        ],
      },
    };

    const applied = applyDefaultEdit(withCustom, { seed: 5, now: NOW });
    const restored = unapplyDefaultEdit(applied, NOW);

    assert.equal(restored.defaultEdit, null);
    assert.deepEqual(restored.custom, withCustom.custom);
    assert.equal(restored.sourceUri, base.sourceUri);
    // Inputs are never mutated.
    assert.notEqual(applied.defaultEdit, null);
  });
});

describe("buildTimeline", () => {
  it("without edits is one clip of the whole video", () => {
    const timeline = buildTimeline(config(48));
    assert.equal(timeline.items.length, 1);
    assert.equal(timeline.cuts.length, 0);
    assert.equal(timeline.outputDuration, 48);
  });

  it("freezes extend the output and no source time is lost", () => {
    const applied = applyDefaultEdit(config(300), { seed: 42, now: NOW });
    const timeline = buildTimeline(applied);
    const freezeTotal = applied.defaultEdit!.freezes.reduce((sum, f) => sum + f.duration, 0);

    assert.equal(timeline.outputDuration, Math.round((300 + freezeTotal) * 1000) / 1000);

    // Clips cover the source exactly once, in order.
    const clips = timeline.items.filter((item) => item.type === "clip");
    assert.equal(clips[0].sourceStart, 0);
    assert.equal(clips.at(-1)!.sourceEnd, 300);
    clips.forEach((clip, i) => {
      if (i > 0) assert.equal(clip.sourceStart, clips[i - 1].sourceEnd);
    });

    // Output items are back to back.
    timeline.items.forEach((item, i) => {
      if (i > 0) assert.equal(item.outputStart, timeline.items[i - 1].outputEnd);
    });
  });

  it("custom transition wins over default at the same cut; default returns when removed", () => {
    const applied = applyDefaultEdit(config(300), { seed: 3, now: NOW });
    const cut = applied.defaultEdit!.transitions[0].at;
    const custom: TransitionEffect = { id: "c", origin: "custom", at: cut, kind: "slideleft", duration: 0.6 };

    const withCustom = { ...applied, custom: { ...applied.custom, transitions: [custom] } };
    const atCut = resolveTransitions(withCustom).filter((t) => t.at === cut);
    assert.equal(atCut.length, 1);
    assert.equal(atCut[0].origin, "custom");

    const atCutAfterRemoval = resolveTransitions(applied).filter((t) => t.at === cut);
    assert.equal(atCutAfterRemoval[0].origin, "default");
  });

  it("clamps a transition that is too long for its neighbours", () => {
    const base = config(10);
    const long: TransitionEffect = { id: "t", origin: "custom", at: 1, kind: "dissolve", duration: 3 };
    const timeline = buildTimeline({ ...base, custom: { ...base.custom, transitions: [long] } });
    assert.equal(timeline.cuts[0].transition!.duration, 0.5); // half of the 1 s first clip
  });
});

describe("mapSourceToOutput", () => {
  it("shifts times at/after each freeze by the freeze duration", () => {
    const base = config(60);
    const edited: EditConfig = {
      ...base,
      custom: {
        ...base.custom,
        freezes: [
          { id: "f1", origin: "custom", sourceTime: 10, duration: 5, zoomFrom: 1, zoomTo: 1.1, zoomDirection: "center" },
          { id: "f2", origin: "custom", sourceTime: 30, duration: 3, zoomFrom: 1, zoomTo: 1.1, zoomDirection: "center" },
        ],
      },
    };

    assert.equal(mapSourceToOutput(edited, 5), 5);
    assert.equal(mapSourceToOutput(edited, 10), 15); // a line starting at the freeze resumes after it
    assert.equal(mapSourceToOutput(edited, 20), 25);
    assert.equal(mapSourceToOutput(edited, 45), 53);
  });
});

describe("parseEditConfig", () => {
  it("round-trips a saved config", () => {
    const applied = applyDefaultEdit(config(90), { seed: 8, now: NOW });
    assert.deepEqual(parseEditConfig(JSON.stringify(applied)), applied);
  });

  it("returns null for corrupt or unknown data instead of crashing", () => {
    assert.equal(parseEditConfig("not json"), null);
    assert.equal(parseEditConfig("null"), null);
    assert.equal(parseEditConfig(JSON.stringify({ version: 99 })), null);
  });
});
