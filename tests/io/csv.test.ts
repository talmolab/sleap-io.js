// Tests for the SLEAP Analysis CSV export (sleap-io PR #480 parity): one row per
// instance, alphabetically-sorted node columns, and full-video-span empty-frame
// padding under includeEmpty.

import { describe, it, expect } from "../bun-test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { labelsToCsv, saveLabelsCsv } from "../../src/io/csv.js";
import { Labels } from "../../src/model/labels.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import {
  Instance,
  PredictedInstance,
  Track,
} from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";

/** Split CSV text into [header[], rows[][]] (no quoted-comma handling). */
function parse(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split("\n").filter((l) => l.length > 0);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, rows };
}

const skel = () => new Skeleton({ nodes: ["thorax", "head"] });

describe("labelsToCsv — SLEAP Analysis format", () => {
  it("writes one row per predicted instance with sorted node columns", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const track0 = new Track("track0");
    const inst = PredictedInstance.fromArray(
      [
        [10, 20, 0.9],
        [30, 40, 0.8],
      ],
      s,
      0.95,
    );
    inst.track = track0;
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
      tracks: [track0],
    });

    const { header, rows } = parse(labelsToCsv(labels));
    // Base cols then alphabetical node cols (score < x < y; head < thorax).
    expect(header).toEqual([
      "track",
      "frame_idx",
      "instance.score",
      "head.score",
      "head.x",
      "head.y",
      "thorax.score",
      "thorax.x",
      "thorax.y",
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual([
      "track0",
      "0",
      "0.95",
      "0.8", // head.score
      "30", // head.x
      "40", // head.y
      "0.9", // thorax.score
      "10", // thorax.x
      "20", // thorax.y
    ]);
  });

  it("leaves instance.score and node scores empty for user instances", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const inst = new Instance({
      points: { thorax: [1, 2], head: [3, 4] },
      skeleton: s,
    });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });

    const { header, rows } = parse(labelsToCsv(labels));
    // No .score columns at all for a user-only project.
    expect(header).toEqual([
      "track",
      "frame_idx",
      "instance.score",
      "head.x",
      "head.y",
      "thorax.x",
      "thorax.y",
    ]);
    expect(rows[0][0]).toBe(""); // track (untracked)
    expect(rows[0][2]).toBe(""); // instance.score (user)
  });

  it("omits score columns when includeScore=false", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const inst = PredictedInstance.fromArray(
      [
        [1, 2, 0.5],
        [3, 4, 0.6],
      ],
      s,
      0.7,
    );
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });
    const { header } = parse(labelsToCsv(labels, { includeScore: false }));
    // No NODE score columns; the base instance.score column always remains.
    expect(
      header.some((c) => c.endsWith(".score") && c !== "instance.score"),
    ).toBe(false);
    expect(header).toContain("instance.score");
  });

  it("writes empty cells for invisible / NaN points", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    // head invisible -> NaN coords.
    const inst = new Instance({
      points: { thorax: [1, 2], head: [Number.NaN, Number.NaN] },
      skeleton: s,
    });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });
    const { header, rows } = parse(labelsToCsv(labels));
    const hx = header.indexOf("head.x");
    const tx = header.indexOf("thorax.x");
    expect(rows[0][hx]).toBe(""); // invisible head
    expect(rows[0][tx]).toBe("1"); // visible thorax
  });

  // A hidden point keeps its old coordinates in memory; the CSV must not show
  // them as a labeled point (sleap-io #564).
  it("writes empty x/y for points marked not visible that still have coords", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const user = new Instance({
      points: { thorax: [1, 2], head: [3, 4] },
      skeleton: s,
    });
    user.points[1].visible = false; // head
    const pred = PredictedInstance.fromArray(
      [
        [5, 6, 0.9],
        [7, 8, 0.4],
      ],
      s,
      0.8,
    );
    pred.points[0].visible = false; // thorax
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [user, pred],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });
    const { header, rows } = parse(
      labelsToCsv(labels, { preferUserInstances: false }),
    );
    const col = (n: string) => header.indexOf(n);
    expect([rows[0][col("head.x")], rows[0][col("head.y")]]).toEqual(["", ""]);
    expect([rows[0][col("thorax.x")], rows[0][col("thorax.y")]]).toEqual([
      "1",
      "2",
    ]);
    expect([rows[1][col("thorax.x")], rows[1][col("thorax.y")]]).toEqual([
      "",
      "",
    ]);
    // The point score is still written, as in Python.
    expect(rows[1][col("thorax.score")]).toBe("0.9");
  });

  it("pads empty frames to the full video length under includeEmpty (#480)", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    video.shape = [10, 4, 4, 1]; // 10 frames total
    const mk = (f: number) => {
      const inst = PredictedInstance.fromArray(
        [
          [1, 2, 0.5],
          [3, 4, 0.6],
        ],
        s,
        0.9,
      );
      return new LabeledFrame({ video, frameIdx: f, instances: [inst] });
    };
    // Labeled only at frames 2 and 5.
    const labels = new Labels({
      labeledFrames: [mk(2), mk(5)],
      videos: [video],
      skeletons: [s],
    });

    const { rows } = parse(labelsToCsv(labels, { includeEmpty: true }));
    // 2 instance rows + 8 empty rows = 10, one per frame 0..9, sorted by frame.
    expect(rows.length).toBe(10);
    const frameCol = 1; // frame_idx
    expect(rows.map((r) => Number(r[frameCol]))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    // Empty frame 0 has blank track + coords; frame 2 (labeled) has coords.
    expect(rows[0][0]).toBe(""); // frame 0 track empty
    expect(parse(labelsToCsv(labels, { includeEmpty: true })).header).toContain(
      "thorax.x",
    );
  });

  it("falls back to last labeled frame + 1 when the video length is unknown", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" }); // no shape
    const inst = () =>
      PredictedInstance.fromArray(
        [
          [1, 2, 0.5],
          [3, 4, 0.6],
        ],
        s,
        0.9,
      );
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 1, instances: [inst()] }),
        new LabeledFrame({ video, frameIdx: 3, instances: [inst()] }),
      ],
      videos: [video],
      skeletons: [s],
    });
    const { rows } = parse(labelsToCsv(labels, { includeEmpty: true }));
    // Range 0..(3+1) exclusive -> frames 0,1,2,3.
    expect(rows.map((r) => Number(r[1]))).toEqual([0, 1, 2, 3]);
  });

  it("respects startFrame / endFrame", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const mk = (f: number) =>
      new LabeledFrame({
        video,
        frameIdx: f,
        instances: [
          PredictedInstance.fromArray(
            [
              [1, 2, 0.5],
              [3, 4, 0.6],
            ],
            s,
            0.9,
          ),
        ],
      });
    const labels = new Labels({
      labeledFrames: [mk(0), mk(1), mk(2), mk(3)],
      videos: [video],
      skeletons: [s],
    });
    const { rows } = parse(labelsToCsv(labels, { startFrame: 1, endFrame: 3 }));
    // endFrame exclusive -> frames 1, 2 only.
    expect(rows.map((r) => Number(r[1]))).toEqual([1, 2]);
  });

  it("filters to a single video by index", () => {
    const s = skel();
    const v0 = new Video({ filename: "a.mp4" });
    const v1 = new Video({ filename: "b.mp4" });
    const mk = (video: Video, f: number) =>
      new LabeledFrame({
        video,
        frameIdx: f,
        instances: [
          PredictedInstance.fromArray(
            [
              [1, 2, 0.5],
              [3, 4, 0.6],
            ],
            s,
            0.9,
          ),
        ],
      });
    const labels = new Labels({
      labeledFrames: [mk(v0, 0), mk(v1, 0), mk(v1, 1)],
      videos: [v0, v1],
      skeletons: [s],
    });
    expect(parse(labelsToCsv(labels, { video: 1 })).rows.length).toBe(2);
    expect(parse(labelsToCsv(labels, { video: v0 })).rows.length).toBe(1);
    expect(parse(labelsToCsv(labels)).rows.length).toBe(3); // all videos
  });

  it("quotes track names containing commas", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const inst = PredictedInstance.fromArray(
      [
        [1, 2, 0.5],
        [3, 4, 0.6],
      ],
      s,
      0.9,
    );
    inst.track = new Track("a,b");
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });
    const csv = labelsToCsv(labels);
    expect(csv.split("\n")[1].startsWith('"a,b",0,')).toBe(true);
  });

  it("saveLabelsCsv writes the same text to disk", async () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const inst = PredictedInstance.fromArray(
      [
        [1, 2, 0.5],
        [3, 4, 0.6],
      ],
      s,
      0.9,
    );
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [s],
    });
    const path = join(
      tmpdir(),
      `sleapio_csv_${Date.now()}_${Math.floor(Math.random() * 1e6)}.csv`,
    );
    try {
      await saveLabelsCsv(labels, path);
      const onDisk = readFileSync(path, "utf8");
      expect(onDisk).toBe(labelsToCsv(labels));
    } finally {
      rmSync(path, { force: true });
    }
  });
});

// One row per animal per frame (sleap-io #591): a user instance that replaced a
// prediction must not be written next to that prediction.
describe("labelsToCsv — one row per animal (preferUserInstances)", () => {
  const pred = (s: Skeleton, x: number, track: Track | null = null) => {
    const p = PredictedInstance.fromArray(
      [
        [x, x, 0.9],
        [x + 1, x + 1, 0.9],
      ],
      s,
      0.5,
    );
    p.track = track;
    return p;
  };
  const user = (
    s: Skeleton,
    x: number,
    opts: { track?: Track; fromPredicted?: PredictedInstance } = {},
  ) =>
    new Instance({
      points: { thorax: [x, x], head: [x + 1, x + 1] },
      skeleton: s,
      track: opts.track ?? null,
      fromPredicted: opts.fromPredicted ?? null,
    });
  const thoraxX = (csv: string) => {
    const { header, rows } = parse(csv);
    const i = header.indexOf("thorax.x");
    return rows.map((r) => `${r[1]}:${r[i]}`);
  };

  // Two animals per frame, so the multi-instance rules apply.
  function multiAnimal() {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const a = new Track("a");
    const b = new Track("b");
    const p0 = pred(s, 10, a);
    const p1 = pred(s, 20, b);
    const p2 = pred(s, 30, a);
    const p3 = pred(s, 40, b);
    const p4 = pred(s, 50, b);
    const frames = [
      // Accepted prediction: linked by fromPredicted (no track) -> p0 dropped.
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [p0, p1, user(s, 11, { fromPredicted: p0 })],
      }),
      // Same track, no link -> p2 dropped.
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [p2, p3, user(s, 31, { track: a })],
      }),
      // Unrelated user instance -> prediction kept.
      new LabeledFrame({ video, frameIdx: 2, instances: [p4, user(s, 61)] }),
    ];
    return new Labels({
      labeledFrames: frames,
      videos: [video],
      skeletons: [s],
      tracks: [a, b],
    });
  }

  it("drops predictions replaced by fromPredicted or by track, keeps the rest", () => {
    expect(thoraxX(labelsToCsv(multiAnimal()))).toEqual([
      "0:11",
      "0:20",
      "1:31",
      "1:40",
      "2:61",
      "2:50",
    ]);
  });

  // Opt-out keeps the old every-instance output (users first, then predictions).
  it("writes every instance with preferUserInstances: false", () => {
    expect(
      thoraxX(labelsToCsv(multiAnimal(), { preferUserInstances: false })),
    ).toEqual(["0:11", "0:10", "0:20", "1:31", "1:30", "1:40", "2:61", "2:50"]);
  });

  // With at most one animal per frame, any user instance stands for it.
  it("lets any user instance replace predictions in a single-instance project", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [pred(s, 10), user(s, 11)],
        }),
        new LabeledFrame({ video, frameIdx: 1, instances: [pred(s, 20)] }),
      ],
      videos: [video],
      skeletons: [s],
    });
    expect(thoraxX(labelsToCsv(labels))).toEqual(["0:11", "1:20"]);
  });

  // Empty-frame padding still works alongside the selection.
  it("still pads empty frames under includeEmpty", () => {
    const s = skel();
    const video = new Video({ filename: "v.mp4" });
    video.shape = [3, 4, 4, 1];
    const p = pred(s, 10);
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 1,
          instances: [p, user(s, 11, { fromPredicted: p })],
        }),
      ],
      videos: [video],
      skeletons: [s],
    });
    expect(thoraxX(labelsToCsv(labels, { includeEmpty: true }))).toEqual([
      "0:",
      "1:11",
      "2:",
    ]);
  });
});
