// Run with: npm test
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyDefaultEdit,
  buildTimeline,
  createEmptyEditConfig,
} from "../timeline/editTimeline.ts";
import { buildRenderArgs, type SourceInfo } from "./renderCommand.ts";

const NOW = new Date("2026-11-27T00:00:00.000Z");
const SOURCE: SourceInfo = {
  width: 720,
  height: 1280,
  frameRate: 30,
  hasAudio: true,
  videoBitrate: 4_000_000,
};

function filterGraph(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

function render(seed: number, duration = 48, source = SOURCE) {
  const config = applyDefaultEdit(
    createEmptyEditConfig("file:///in.mp4", duration, NOW),
    { seed, now: NOW },
  );
  const timeline = buildTimeline(config);
  const args = buildRenderArgs({
    timeline,
    source,
    inputPath: "/data/in put.mp4",
    outputPath: "/data/out.mp4",
    encoder: "h264_mediacodec",
  });
  return { config, timeline, args, graph: filterGraph(args) };
}

describe("buildRenderArgs", () => {
  it("never writes to the input file and passes paths as single arguments", () => {
    const { args } = render(1596253651);
    assert.equal(args[args.indexOf("-i") + 1], "/data/in put.mp4");
    assert.equal(args.at(-1), "/data/out.mp4");
    assert.notEqual(args.at(-1), args[args.indexOf("-i") + 1]);
  });

  it("matches the user's real phone edit (seed 1596253651): 3 clips + 2 freezes", () => {
    const { timeline, graph } = render(1596253651);
    assert.equal(timeline.items.filter((i) => i.type === "clip").length, 5); // 3 segments split by 2 freezes
    assert.equal(timeline.items.filter((i) => i.type === "freeze").length, 2);
    assert.equal((graph.match(/zoompan=/g) ?? []).length, 2);
    assert.equal((graph.match(/xfade=/g) ?? []).length, 2);
  });

  it("starts every xfade exactly where the incoming item starts on the timeline (sync)", () => {
    for (const seed of [1, 2, 3, 1596253651, 99]) {
      const { timeline, graph } = render(seed, 300);
      const offsets = [...graph.matchAll(/xfade=transition=\w+:duration=([\d.]+):offset=([\d.]+)/g)].map(
        (m) => Number(m[2]),
      );
      const expected = timeline.cuts
        .filter((c) => c.transition)
        .map((c) => timeline.items[c.afterItemIndex + 1].outputStart);

      assert.equal(offsets.length, expected.length);
      offsets.forEach((offset, i) => assert.ok(Math.abs(offset - expected[i]) < 0.01, `seed ${seed}: ${offset} vs ${expected[i]}`));
    }
  });

  it("silences audio during freezes and never pads audio (no drift)", () => {
    const { graph } = render(1596253651);
    assert.equal((graph.match(/anullsrc=/g) ?? []).length, 2);
    assert.ok(!graph.includes("apad"));
    assert.match(graph, /concat=n=7:v=0:a=1\[aout\]/);
  });

  it("uses only filters available in the bundled FFmpegKit min build", () => {
    const allowed = new Set([
      "split", "asplit", "null", "anull", "trim", "atrim", "setpts", "asetpts", "fps", "scale",
      "setsar", "format", "settb", "tpad", "zoompan", "xfade", "concat", "anullsrc", "aformat",
    ]);
    const { graph } = render(7, 300);
    const used = new Set([...graph.matchAll(/(?:^|[\],;])([a-z_]+)=/g)].map((m) => m[1]));
    for (const name of used) {
      if (["start", "end", "end_frame", "stop_mode", "stop_duration", "duration", "offset", "transition", "z", "x", "y", "d", "s", "n", "v", "a", "flags", "channel_layout", "sample_rate", "sample_rates", "channel_layouts"].includes(name)) continue;
      assert.ok(allowed.has(name), `unexpected filter: ${name}`);
    }
  });

  it("forces even dimensions and a sane frame rate", () => {
    const { graph } = render(5, 48, { ...SOURCE, width: 721, height: 1281, frameRate: 0 });
    assert.match(graph, /scale=720:1280/);
    assert.match(graph, /fps=30,/);
  });

  it("renders silence for videos without an audio track", () => {
    const { graph } = render(5, 48, { ...SOURCE, hasAudio: false });
    assert.ok(!graph.includes("[0:a]"));
  });

  it("falls back to the software encoder when asked", () => {
    const config = createEmptyEditConfig("file:///in.mp4", 10, NOW);
    const args = buildRenderArgs({
      timeline: buildTimeline(config),
      source: SOURCE,
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      encoder: "mpeg4",
    });
    assert.deepEqual(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2), ["-c:v", "mpeg4"]);
  });
});
