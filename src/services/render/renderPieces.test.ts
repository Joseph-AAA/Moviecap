// Run with: npm test
/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EditConfig } from "../../types/edit.ts";
import {
  applyDefaultEdit,
  buildTimeline,
  createEmptyEditConfig,
  cropTimeline,
} from "../timeline/editTimeline.ts";
import {
  buildConcatList,
  buildFinalArgs,
  buildPieceArgs,
  planPieces,
  type SourceInfo,
} from "./renderPieces.ts";

const NOW = new Date("2026-11-27T00:00:00.000Z");
const SOURCE: SourceInfo = { width: 720, height: 1280, frameRate: 30, hasAudio: true, videoBitrate: 1_375_000 };
const FPS = 30;

/** The user's real edit from the phone (40 s video, My Default + custom). */
function userEdit(): EditConfig {
  const base = createEmptyEditConfig("file:///original.mp4", 40.033, NOW);
  return {
    ...base,
    defaultEdit: {
      source: "mine",
      seed: 0,
      generatedAt: NOW.toISOString(),
      segments: [
        { id: "a", start: 0, end: 10.008 },
        { id: "b", start: 10.008, end: 15.846 },
        { id: "c", start: 15.846, end: 26.355 },
        { id: "d", start: 26.355, end: 33.027 },
        { id: "e", start: 33.027, end: 40.033 },
      ],
      transitions: [10.008, 15.846, 26.355, 33.027].map((at, i) => ({
        id: `t${i}`, origin: "default" as const, at, kind: "dissolve" as const, duration: 0.5,
      })),
      freezes: [6.005, 20.35].map((t, i) => ({
        id: `f${i}`, origin: "default" as const, sourceTime: t, duration: 5, zoomFrom: 1, zoomTo: 1.15, zoomDirection: "center" as const,
      })),
    },
    custom: {
      transitions: [
        { id: "c1", origin: "custom", at: 1.448, kind: "dissolve", duration: 0.4 },
        { id: "c2", origin: "custom", at: 3.4, kind: "fade", duration: 0.4 },
        { id: "c3", origin: "custom", at: 7.646, kind: "fade", duration: 0.4 },
      ],
      freezes: [],
      blurs: [],
    },
  };
}

const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("planPieces", () => {
  it("frame counts add up exactly to the export length (audio stays in sync)", () => {
    const timelines = [
      buildTimeline(userEdit()),
      ...[1, 2, 3, 42, 1596253651].map((seed) =>
        buildTimeline(applyDefaultEdit(createEmptyEditConfig("file:///x.mp4", 300, NOW), { seed, now: NOW })),
      ),
      cropTimeline(buildTimeline(userEdit()), 8.3, 31.7),
    ];
    for (const timeline of timelines) {
      const pieces = planPieces(timeline, FPS);
      const total = pieces.reduce((sum, p) => sum + p.frames, 0);
      assert.equal(total, Math.floor(timeline.outputDuration * FPS + 1e-6));
    }
  });

  it("puts each transition inside the piece that follows it", () => {
    const timeline = buildTimeline(userEdit());
    const pieces = planPieces(timeline, FPS);
    const withTransitions = pieces.filter((p) => p.transitionIn);
    assert.equal(withTransitions.length, timeline.cuts.filter((c) => c.transition).length);
    // Each transition's still comes from the piece just before it.
    for (const p of withTransitions) assert.equal(p.transitionIn!.fromPiece, p.index - 1);
  });
});

describe("buildPieceArgs", () => {
  it("renders every piece of the user's edit as a small, exact, video-only run", () => {
    const pieces = planPieces(buildTimeline(userEdit()), FPS);
    pieces.forEach((piece) => {
      const args = buildPieceArgs({
        piece, source: SOURCE, inputPath: "/in put.mp4", outputPath: `/tmp/p${piece.index}.mp4`, encoder: "h264_mediacodec",
        previousPiecePath: `/tmp/p${piece.index - 1}.mp4`,
      });
      const graph = graphOf(args);
      assert.equal(args[args.indexOf("-frames:v") + 1], String(piece.frames));
      assert.ok(args.includes("-an"));
      assert.equal(args.at(-1), `/tmp/p${piece.index}.mp4`);
      assert.ok(!graph.includes("split"), "no split: each piece reads only its own part");
      // Every input is length-limited, so FFmpeg 6.0 never decodes ahead.
      const inputCount = args.filter((x) => x === "-i").length;
      const limits = args.filter((x) => x === "-t").length;
      assert.equal(limits, inputCount, "each -i has a -t");
      args.forEach((x, k) => {
        if (x === "-t") assert.ok(Number(args[k + 1]) <= piece.frames / 30 + 0.5 + 0.001);
      });
      if (piece.transitionIn) {
        assert.match(graph, /xfade=transition=\w+:duration=[\d.]+:offset=0\[v\]/);
        assert.ok(args.includes(`/tmp/p${piece.index - 1}.mp4`), "tail read from the previous piece");
        assert.equal((graph.match(/zoompan=/g) ?? []).length, piece.content.type === "freeze" ? 1 : 0);
      }
      if (piece.content.type === "freeze") assert.match(graph, /zoompan=/);
    });
  });

  it("uses only filters available in the bundled FFmpegKit min build", () => {
    const allowed = new Set(["trim", "setpts", "fps", "scale", "setsar", "format", "settb", "tpad", "zoompan", "xfade"]);
    const params = new Set(["end_frame", "stop_mode", "stop_duration", "duration", "offset", "transition", "z", "x", "y", "d", "s", "flags"]);
    for (const piece of planPieces(buildTimeline(userEdit()), FPS)) {
      const graph = graphOf(buildPieceArgs({ piece, source: SOURCE, inputPath: "/in.mp4", outputPath: "/o.mp4", encoder: "mpeg4", previousPiecePath: "/prev.mp4" }));
      for (const m of graph.matchAll(/(?:^|[\],;:])([a-z_]+)=/g)) {
        if (params.has(m[1])) continue;
        assert.ok(allowed.has(m[1]), `unexpected filter: ${m[1]}`);
      }
    }
  });
});

describe("joining", () => {
  it("joins pieces without re-encoding video and adds the range's original audio", () => {
    const args = buildFinalArgs({
      listPath: "/tmp/list.txt", inputPath: "/in.mp4", outputPath: "/out.mp4", rangeStart: 8.3, duration: 23.4, hasAudio: true,
    });
    assert.deepEqual(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2), ["-c:v", "copy"]);
    assert.equal(args[args.indexOf("-ss") + 1], "8.3");
    assert.ok(args.includes("1:a:0"));
  });

  it("makes a video-only file for sources without audio", () => {
    const args = buildFinalArgs({
      listPath: "/l.txt", inputPath: "/in.mp4", outputPath: "/o.mp4", rangeStart: 0, duration: 10, hasAudio: false,
    });
    assert.ok(!args.includes("1:a:0"));
  });

  it("writes a safe concat list", () => {
    assert.equal(buildConcatList(["/a/p0.mp4", "/a/it's.mp4"]), "file '/a/p0.mp4'\nfile '/a/it'\\''s.mp4'\n");
  });
});
