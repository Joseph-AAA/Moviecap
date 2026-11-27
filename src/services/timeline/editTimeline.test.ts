// Run with: npm test   (uses Node's built-in test runner, no extra packages)
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EditConfig, MyDefaultPreset, TransitionEffect } from "../../types/edit.ts";
import {
  ALL_TRANSITION_KINDS,
  DEFAULT_RULES,
  applyDefaultEdit,
  applyMyDefault,
  buildTimeline,
  createStarterPreset,
  cropTimeline,
  generateFromPreset,
  parseMyDefaultPreset,
  presetFromConfig,
  resolveFreezes,
  createEmptyEditConfig,
  cutPlacementProblem,
  listTransitionSlots,
  removeCustomTransition,
  setCustomTransition,
  generateDefaultEdit,
  mapSourceToOutput,
  parseEditConfig,
  resolveTransitions,
  unapplyDefaultEdit,
} from "./editTimeline.ts";

const NOW = new Date("2026-11-27T00:00:00.000Z");

function config(duration: number): EditConfig {
  return createEmptyEditConfig("file:///video.mp4", duration, NOW);
}

describe("Apply Default rules (every 6 s under 1 min, every 15 s from 1 min)", () => {
  /** All effect times (transitions and freezes), in order. */
  const effectTimes = (duration: number, seed: number) => {
    const edit = generateDefaultEdit(duration, seed, NOW);
    return [...edit.transitions.map((t) => t.at), ...edit.freezes.map((f) => f.sourceTime)].sort((a, b) => a - b);
  };

  it("30 s video: an effect at 0:06, 0:12, 0:18, 0:24 — each a transition or a 3 s freeze", () => {
    for (let seed = 1; seed <= 50; seed++) {
      assert.deepEqual(effectTimes(30, seed), [6, 12, 18, 24]);
      const edit = generateDefaultEdit(30, seed, NOW);
      edit.freezes.forEach((f) => {
        assert.equal(f.duration, 3);
        assert.ok(f.zoomTo > f.zoomFrom, "freezes always zoom in");
      });
      edit.transitions.forEach((t) => {
        assert.ok(ALL_TRANSITION_KINDS.includes(t.kind));
        assert.ok((DEFAULT_RULES.short.transitionSeconds as readonly number[]).includes(t.duration));
      });
    }
  });

  it("2:00 video: an effect every 15 s; 5 s freezes; 5/7/8 s transitions", () => {
    for (let seed = 1; seed <= 50; seed++) {
      assert.deepEqual(effectTimes(120, seed), [15, 30, 45, 60, 75, 90, 105]);
      const edit = generateDefaultEdit(120, seed, NOW);
      edit.freezes.forEach((f) => assert.equal(f.duration, 5));
      edit.transitions.forEach((t) =>
        assert.ok((DEFAULT_RULES.long.transitionSeconds as readonly number[]).includes(t.duration)),
      );
    }
  });

  it("50–59 s and under 20 s use the 6-second rule; exactly 1:00 uses the 15-second rule", () => {
    assert.deepEqual(effectTimes(55, 1), [6, 12, 18, 24, 30, 36, 42, 48, 54]);
    assert.deepEqual(effectTimes(12, 1), [6]);
    assert.deepEqual(effectTimes(60, 1), [15, 30, 45]);
  });

  it("is really random: both effect types and many transition types appear", () => {
    const kinds = new Set<string>();
    let freezes = 0;
    let transitions = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const edit = generateDefaultEdit(300, seed, NOW);
      freezes += edit.freezes.length;
      transitions += edit.transitions.length;
      edit.transitions.forEach((t) => kinds.add(t.kind));
    }
    assert.ok(freezes > 100 && transitions > 100);
    assert.ok(kinds.size >= 8);
  });

  it("a freeze that wouldn't fit before the end becomes a transition", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const edit = generateDefaultEdit(26, seed, NOW); // 0:24 + 3 s > 25.5
      assert.ok(edit.freezes.every((f) => f.sourceTime + f.duration <= 25.5));
      assert.ok(edit.transitions.some((t) => t.at === 24));
    }
  });

  it("segments cover the whole video and the edit is reproducible from its seed", () => {
    const edit = generateDefaultEdit(300, 1234, NOW);
    assert.equal(edit.segments[0].start, 0);
    assert.equal(edit.segments.at(-1)!.end, 300);
    edit.segments.forEach((seg, i) => {
      if (i > 0) assert.equal(seg.start, edit.segments[i - 1].end);
    });
    assert.deepEqual(generateDefaultEdit(300, 1234, NOW), edit);
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

  it("freezes replace video: same length, items back to back, output time == source time", () => {
    for (const seed of [1, 42, 1596253651]) {
      const applied = applyDefaultEdit(config(300), { seed, now: NOW });
      const timeline = buildTimeline(applied);

      assert.equal(timeline.outputDuration, 300);
      assert.equal(timeline.items[0].outputStart, 0);
      assert.equal(timeline.items.at(-1)!.outputEnd, 300);

      timeline.items.forEach((item, i) => {
        assert.equal(item.outputStart, item.sourceStart);
        if (i > 0) assert.equal(item.sourceStart, timeline.items[i - 1].sourceEnd);
      });

      // Each freeze item replaces exactly its 5 s stretch.
      const freezeItems = timeline.items.filter((item) => item.type === "freeze");
      assert.equal(freezeItems.length, applied.defaultEdit!.freezes.length);
      freezeItems.forEach((item) =>
        assert.ok(Math.abs(item.sourceEnd - item.sourceStart - 5) < 0.001),
      );
    }
  });

  it("dissolves back to live video when a freeze ends", () => {
    const base = config(30);
    const edited: EditConfig = {
      ...base,
      custom: {
        ...base.custom,
        freezes: [{ id: "f", origin: "custom", sourceTime: 10, duration: 5, zoomFrom: 1, zoomTo: 1.1, zoomDirection: "center" }],
      },
    };
    const timeline = buildTimeline(edited);
    assert.deepEqual(timeline.items.map((i) => i.type), ["clip", "freeze", "clip"]);
    assert.equal(timeline.cuts[0].transition, null); // entering: seamless
    assert.equal(timeline.cuts[1].transition?.kind, "dissolve"); // leaving: dissolve
  });

  it("drops a later freeze that overlaps an earlier one, and transitions inside a freeze", () => {
    const base = config(60);
    const freeze = (id: string, t: number) => ({
      id, origin: "custom" as const, sourceTime: t, duration: 5, zoomFrom: 1, zoomTo: 1.1, zoomDirection: "center" as const,
    });
    const edited: EditConfig = {
      ...base,
      custom: {
        transitions: [{ id: "t", origin: "custom", at: 12, kind: "fade", duration: 0.4 }],
        freezes: [freeze("a", 10), freeze("b", 13)],
        blurs: [],
      },
    };
    const timeline = buildTimeline(edited);
    assert.equal(timeline.items.filter((i) => i.type === "freeze").length, 1);
    assert.ok(timeline.cuts.every((c) => c.transition?.id !== "t"));
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
    assert.equal(timeline.cuts[0].transition!.duration, 1); // the 1 s first clip is the limit
  });
});

describe("mapSourceToOutput", () => {
  it("is the identity because audio keeps playing under freezes", () => {
    const applied = applyDefaultEdit(config(120), { seed: 9, now: NOW });
    for (const t of [0, 12.5, 60, 119]) assert.equal(mapSourceToOutput(applied, t), t);
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

describe("custom transitions (Phase 8)", () => {
  it("custom replaces default at a cut; removing it brings the default back", () => {
    const applied = applyDefaultEdit(config(120), { seed: 11, now: NOW });
    const cut = applied.defaultEdit!.transitions[0].at;

    const custom = setCustomTransition(applied, cut, "slideleft", 0.8, NOW);
    const slot = listTransitionSlots(custom).find((s) => s.at === cut)!;
    assert.equal(slot.source, "custom");
    assert.equal(slot.effective?.kind, "slideleft");
    assert.equal(slot.effective?.duration, 0.8);
    // Default transition is untouched.
    assert.deepEqual(custom.defaultEdit, applied.defaultEdit);

    const reset = removeCustomTransition(custom, cut, NOW);
    const back = listTransitionSlots(reset).find((s) => s.at === cut)!;
    assert.equal(back.source, "default");
    assert.equal(back.effective?.kind, applied.defaultEdit!.transitions[0].kind);
  });

  it("setting twice at the same cut replaces instead of stacking", () => {
    const once = setCustomTransition(config(60), 20, "fade", 0.4, NOW);
    const twice = setCustomTransition(once, 20.01, "fadeblack", 0.6, NOW);
    assert.equal(twice.custom.transitions.length, 1);
    assert.equal(twice.custom.transitions[0].kind, "fadeblack");
  });

  it("adds a new cut at the playhead without Default Edit, and survives Unapply", () => {
    const withCut = setCustomTransition(config(60), 20, "dissolve", 0.4, NOW);
    assert.deepEqual(buildTimeline(withCut).items.map((i) => i.type), ["clip", "clip"]);

    const applied = applyDefaultEdit(withCut, { seed: 3, now: NOW });
    const unapplied = unapplyDefaultEdit(applied, NOW);
    assert.deepEqual(unapplied.custom.transitions, withCut.custom.transitions);
  });

  it("refuses cuts inside a freeze or at the very ends", () => {
    const base = config(60);
    const edited: EditConfig = {
      ...base,
      custom: {
        ...base.custom,
        freezes: [{ id: "f", origin: "custom", sourceTime: 10, duration: 5, zoomFrom: 1, zoomTo: 1.1, zoomDirection: "center" }],
      },
    };
    assert.ok(cutPlacementProblem(edited, 12));
    assert.ok(cutPlacementProblem(edited, 0.2));
    assert.ok(cutPlacementProblem(edited, 59.9));
    assert.equal(cutPlacementProblem(edited, 30), null);
  });
});

describe("My Default preset (seconds; repeat or exact)", () => {
  const pattern = (overrides: Partial<MyDefaultPreset> = {}): MyDefaultPreset => ({
    version: 2,
    repeat: true,
    patternLength: 50,
    transitions: [
      { at: 5, kind: "fade", duration: 3 },
      { at: 10, kind: "checkerboard", duration: 4 },
      { at: 15, kind: "snowdrift", duration: 5 },
    ],
    freezes: [],
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
  const times = (duration: number, p: MyDefaultPreset) =>
    generateFromPreset(duration, p, NOW).transitions.map((t) => t.at);

  it("repeat ON: the user's example — 0:50 round, effects at 5/10/15 repeat every 50 s", () => {
    assert.deepEqual(times(160, pattern()), [5, 10, 15, 55, 60, 65, 105, 110, 115, 155]);
    // Each repeat keeps its own type and length.
    const kinds = generateFromPreset(160, pattern(), NOW).transitions.map((t) => t.kind);
    assert.deepEqual(kinds.slice(0, 6), ["fade", "checkerboard", "snowdrift", "fade", "checkerboard", "snowdrift"]);
  });

  it("repeat ON: a video shorter than one round only gets the lines that fit", () => {
    assert.deepEqual(times(12, pattern()), [5, 10]);
  });

  it("repeat OFF: exact times once, lines after the end skipped", () => {
    assert.deepEqual(times(160, pattern({ repeat: false })), [5, 10, 15]);
    assert.deepEqual(times(8, pattern({ repeat: false })), [5]);
  });

  it("freezes repeat too and a freeze running past the end is shortened", () => {
    const withFreeze = pattern({ transitions: [], freezes: [{ at: 20, duration: 5, zoomTo: 1.2, zoomDirection: "center" }] });
    const freezes = generateFromPreset(122, withFreeze, NOW).freezes;
    assert.deepEqual(freezes.map((f) => f.sourceTime), [20, 70, 120]);
    assert.equal(freezes.at(-1)!.duration, 2); // 120 + 5 would pass 122
  });

  it("segments always cover the whole video, and Unapply keeps custom transitions", () => {
    const edit = generateFromPreset(160, pattern(), NOW);
    assert.equal(edit.segments[0].start, 0);
    assert.equal(edit.segments.at(-1)!.end, 160);

    const withCustom = setCustomTransition(config(160), 30, "fade", 3, NOW);
    const applied = applyMyDefault(withCustom, pattern(), NOW);
    assert.equal(applied.defaultEdit!.source, "mine");
    assert.deepEqual(unapplyDefaultEdit(applied, NOW).custom.transitions, withCustom.custom.transitions);
  });

  it("starter preset repeats and fits its own round", () => {
    const starter = createStarterPreset(NOW);
    assert.equal(starter.version, 2);
    assert.equal(starter.repeat, true);
    assert.ok(starter.transitions.every((t) => t.at > 0 && t.at < starter.patternLength));
  });

  it("save this edit as My Default: exact seconds, repeat off", () => {
    const base = setCustomTransition(applyDefaultEdit(config(60), { seed: 4, now: NOW }), 50, "slideleft", 3, NOW);
    const preset = presetFromConfig(base, NOW);
    assert.equal(preset.repeat, false);
    assert.equal(preset.patternLength, 60);
    assert.ok(preset.transitions.some((t) => t.kind === "slideleft" && t.at === 50));
    assert.equal(preset.freezes.length, resolveFreezes(base).length);
  });

  it("converts an old percentage preset (version 1) to seconds once", () => {
    const v1 = {
      version: 1,
      referenceDuration: 120,
      transitions: [{ position: 0.25, kind: "dissolve", duration: 0.5 }],
      freezes: [{ position: 0.5, duration: 5, zoomTo: 1.15, zoomDirection: "center" }],
      updatedAt: NOW.toISOString(),
    };
    const parsed = parseMyDefaultPreset(JSON.stringify(v1))!;
    assert.equal(parsed.version, 2);
    assert.equal(parsed.repeat, true);
    assert.equal(parsed.patternLength, 120);
    assert.equal(parsed.transitions[0].at, 30);
    assert.equal(parsed.freezes[0].at, 60);
    assert.equal(parseMyDefaultPreset("{oops"), null);
    assert.equal(parseMyDefaultPreset(JSON.stringify({ version: 3, transitions: [], freezes: [] })), null);
  });
});

describe("cropTimeline (export the trim selection with effects)", () => {
  const freeze = { id: "f", origin: "custom" as const, sourceTime: 20, duration: 5, zoomFrom: 1, zoomTo: 1.2, zoomDirection: "center" as const };
  const edited = (): EditConfig => {
    const base = config(60);
    return {
      ...base,
      custom: { transitions: [{ id: "t", origin: "custom", at: 40, kind: "fade", duration: 0.5 }], freezes: [freeze], blurs: [] },
    };
  };

  it("keeps only the range, back to back from 0, same length as the selection", () => {
    const cropped = cropTimeline(buildTimeline(edited()), 10, 50);
    assert.equal(cropped.outputDuration, 40);
    assert.equal(cropped.items[0].outputStart, 0);
    assert.equal(cropped.items.at(-1)!.outputEnd, 40);
    cropped.items.forEach((item, i) => {
      assert.equal(item.outputStart, Math.round((item.sourceStart - 10) * 1000) / 1000);
      if (i > 0) assert.equal(item.outputStart, cropped.items[i - 1].outputEnd);
    });
    assert.ok(cropped.cuts.some((c) => c.transition?.id === "t"));
  });

  it("drops effects outside the selection", () => {
    const cropped = cropTimeline(buildTimeline(edited()), 30, 39);
    assert.deepEqual(cropped.items.map((i) => i.type), ["clip"]);
    assert.equal(cropped.cuts.length, 0);
  });

  it("continues a freeze's zoom when the selection starts inside it", () => {
    const cropped = cropTimeline(buildTimeline(edited()), 22.5, 30);
    const first = cropped.items[0];
    assert.equal(first.type, "freeze");
    if (first.type === "freeze") {
      assert.equal(first.freeze.sourceTime, 20); // same still frame
      assert.ok(first.freeze.zoomFrom > 1 && first.freeze.zoomFrom < 1.2); // half-way zoom
      assert.equal(first.freeze.zoomTo, 1.2);
    }
  });

  it("the whole range gives back the same timeline", () => {
    const full = buildTimeline(edited());
    const cropped = cropTimeline(full, 0, 60);
    assert.equal(cropped.items.length, full.items.length);
    assert.equal(cropped.cuts.length, full.cuts.length);
  });
});
