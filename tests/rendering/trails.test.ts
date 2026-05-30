import { describe, it, expect } from "../bun-test";
import { renderImage } from "../../src/rendering/render";
import { drawTrails } from "../../src/rendering/shapes";
import {
  resolveTrailNode,
  computeTrails,
  nTrailPaletteColors,
  collectTracks,
} from "../../src/rendering/trails";
import { Skeleton } from "../../src/model/skeleton";
import { Instance, PredictedInstance, Track } from "../../src/model/instance";
import { LabeledFrame } from "../../src/model/labeled-frame";
import { Labels } from "../../src/model/labels";
import { Video } from "../../src/model/video";
import type { RGB } from "../../src/rendering/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Single-node skeleton: centroid == that node, so trail geometry is exact. */
function dotSkeleton(): Skeleton {
  return new Skeleton({ nodes: ["c"] });
}

/** Two-node skeleton for node-target tests. */
function twoNodeSkeleton(): Skeleton {
  return new Skeleton({ nodes: ["head", "tail"], edges: [["head", "tail"]] });
}

function makeInstance(
  skeleton: Skeleton,
  points: Record<string, number[]>,
  track?: Track
): Instance {
  return new Instance({ points, skeleton, track });
}

function makeFrame(
  video: Video,
  frameIdx: number,
  instances: Instance[]
): LabeledFrame {
  return new LabeledFrame({ video, frameIdx, instances });
}

async function makeCtx(
  w: number,
  h: number
): Promise<{ ctx: CanvasRenderingContext2D; read: () => ImageData }> {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    read: () => ctx.getImageData(0, 0, w, h) as unknown as ImageData,
  };
}

function alphaAt(img: ImageData, w: number, x: number, y: number): number {
  return img.data[(y * w + x) * 4 + 3];
}

function rgbaAt(
  img: ImageData,
  w: number,
  x: number,
  y: number
): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// ---------------------------------------------------------------------------
// resolveTrailNode
// ---------------------------------------------------------------------------

describe("resolveTrailNode", () => {
  it("maps 'centroid' to null (case-insensitive)", () => {
    const skel = twoNodeSkeleton();
    expect(resolveTrailNode("centroid", skel)).toEqual([null]);
    expect(resolveTrailNode("Centroid", skel)).toEqual([null]);
    expect(resolveTrailNode("CENTROID", skel)).toEqual([null]);
  });

  it("maps a node name to its index", () => {
    const skel = twoNodeSkeleton();
    expect(resolveTrailNode("head", skel)).toEqual([0]);
    expect(resolveTrailNode("tail", skel)).toEqual([1]);
  });

  it("maps a list of node names to one target each", () => {
    const skel = twoNodeSkeleton();
    expect(resolveTrailNode(["head", "tail"], skel)).toEqual([0, 1]);
    expect(resolveTrailNode(["centroid", "tail"], skel)).toEqual([null, 1]);
  });

  it("throws on an unknown node name", () => {
    const skel = twoNodeSkeleton();
    expect(() => resolveTrailNode("nope", skel)).toThrow("Unknown trailNode");
    expect(() => resolveTrailNode(["head", "nope"], skel)).toThrow(
      "Unknown trailNode"
    );
  });
});

// ---------------------------------------------------------------------------
// nTrailPaletteColors / collectTracks
// ---------------------------------------------------------------------------

describe("nTrailPaletteColors", () => {
  it("uses track count when tracked (min 1)", () => {
    expect(nTrailPaletteColors(true, 3, [])).toBe(3);
    expect(nTrailPaletteColors(true, 0, [])).toBe(1);
  });

  it("uses peak instance count when untracked (min 1)", () => {
    const skel = dotSkeleton();
    const video = new Video({ filename: "v.mp4" });
    const frames = [
      makeFrame(video, 0, [
        makeInstance(skel, { c: [1, 1] }),
        makeInstance(skel, { c: [2, 2] }),
      ]),
      makeFrame(video, 1, [makeInstance(skel, { c: [3, 3] })]),
    ];
    expect(nTrailPaletteColors(false, 0, frames)).toBe(2);
    expect(nTrailPaletteColors(false, 0, [])).toBe(1);
  });
});

describe("collectTracks", () => {
  it("collects distinct tracks in first-appearance order", () => {
    const skel = dotSkeleton();
    const video = new Video({ filename: "v.mp4" });
    const a = new Track("A");
    const b = new Track("B");
    const frames = [
      makeFrame(video, 0, [makeInstance(skel, { c: [1, 1] }, b)]), // B first
      makeFrame(video, 1, [
        makeInstance(skel, { c: [2, 2] }, a),
        makeInstance(skel, { c: [3, 3] }, b), // dedup
      ]),
      makeFrame(video, 2, [makeInstance(skel, { c: [4, 4] })]), // untracked ignored
    ];
    expect(collectTracks(frames)).toEqual([b, a]);
    expect(collectTracks([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeTrails
// ---------------------------------------------------------------------------

describe("computeTrails", () => {
  const skel = dotSkeleton();
  const video = new Video({ filename: "v.mp4" });

  it("builds one polyline per track across the window", () => {
    const track = new Track("A");
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel, { c: [10, 10] }, track)])],
      [1, makeFrame(video, 1, [makeInstance(skel, { c: [10, 20] }, track)])],
      [2, makeFrame(video, 2, [makeInstance(skel, { c: [10, 30] }, track)])],
    ]);
    const { trails, colors } = computeTrails({
      frameIdx: 2,
      frameIdxToLf: frames,
      trailLength: 2,
      trailTargets: [null],
      trackIndexMap: new Map([[track, 0]]),
      paletteColors: [[7, 8, 9]],
      hasTracks: true,
    });
    expect(trails.length).toBe(1);
    expect(trails[0]).toEqual([
      [10, 10],
      [10, 20],
      [10, 30],
    ]);
    expect(colors).toEqual([[7, 8, 9]]);
  });

  it("leaves NaN gaps for missing frames", () => {
    const track = new Track("A");
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel, { c: [10, 10] }, track)])],
      // frame 1 missing
      [2, makeFrame(video, 2, [makeInstance(skel, { c: [10, 30] }, track)])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 2,
      frameIdxToLf: frames,
      trailLength: 2,
      trailTargets: [null],
      trackIndexMap: new Map([[track, 0]]),
      paletteColors: [[1, 2, 3]],
      hasTracks: true,
    });
    expect(trails[0][0]).toEqual([10, 10]);
    expect(Number.isNaN(trails[0][1][0])).toBe(true);
    expect(Number.isNaN(trails[0][1][1])).toBe(true);
    expect(trails[0][2]).toEqual([10, 30]);
  });

  it("emits one trail per node when given a node list", () => {
    const skel2 = twoNodeSkeleton();
    const track = new Track("A");
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel2, { head: [5, 5], tail: [7, 7] }, track)])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [0, 1],
      trackIndexMap: new Map([[track, 0]]),
      paletteColors: [[1, 2, 3]],
      hasTracks: true,
    });
    expect(trails.length).toBe(2);
    expect(trails[0]).toEqual([[5, 5]]);
    expect(trails[1]).toEqual([[7, 7]]);
  });

  it("keys untracked instances by position index", () => {
    const frames = new Map<number, LabeledFrame>([
      [
        0,
        makeFrame(video, 0, [
          makeInstance(skel, { c: [1, 1] }),
          makeInstance(skel, { c: [2, 2] }),
        ]),
      ],
    ]);
    const { trails, colors } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map(),
      paletteColors: [
        [10, 10, 10],
        [20, 20, 20],
      ],
      hasTracks: false,
    });
    expect(trails).toEqual([[[1, 1]], [[2, 2]]]);
    expect(colors).toEqual([
      [10, 10, 10],
      [20, 20, 20],
    ]);
  });

  it("skips untracked instances when hasTracks is true", () => {
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel, { c: [1, 1] })])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map(),
      paletteColors: [[1, 2, 3]],
      hasTracks: true,
    });
    expect(trails.length).toBe(0);
  });

  it("keeps tracked and skips untracked in a mixed frame when hasTracks", () => {
    const a = new Track("A");
    const b = new Track("B");
    const frames = new Map<number, LabeledFrame>([
      [
        0,
        makeFrame(video, 0, [
          makeInstance(skel, { c: [1, 1] }, a),
          makeInstance(skel, { c: [2, 2] }), // untracked -> skipped
          makeInstance(skel, { c: [3, 3] }, b),
        ]),
      ],
    ]);
    const { trails, colors } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map([
        [a, 0],
        [b, 1],
      ]),
      paletteColors: [
        [10, 10, 10],
        [20, 20, 20],
      ],
      hasTracks: true,
    });
    expect(trails).toEqual([[[1, 1]], [[3, 3]]]); // A and B, not the untracked
    expect(colors).toEqual([
      [10, 10, 10],
      [20, 20, 20],
    ]);
  });

  it("reuses a shared points cache across calls (renderVideo path)", () => {
    const track = new Track("A");
    const inst = makeInstance(skel, { c: [10, 10] }, track);
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [inst])],
      [1, makeFrame(video, 1, [makeInstance(skel, { c: [10, 20] }, track)])],
    ]);
    const cache = new Map();
    const common = {
      frameIdxToLf: frames,
      trailLength: 1,
      trailTargets: [null] as (number | null)[],
      trackIndexMap: new Map([[track, 0]]),
      paletteColors: [[1, 2, 3] as RGB],
      hasTracks: true,
      ptsCache: cache,
    };
    const first = computeTrails({ ...common, frameIdx: 0 });
    const second = computeTrails({ ...common, frameIdx: 1 });
    expect(cache.get(inst)).toBeDefined(); // cached the shared frame-0 instance
    // Frame 0 ends its trail at (10,10); frame 1 extends through it.
    expect(first.trails[0][first.trails[0].length - 1]).toEqual([10, 10]);
    expect(second.trails[0]).toEqual([
      [10, 10],
      [10, 20],
    ]);
  });

  it("computes the centroid as the mean of visible nodes", () => {
    const skel2 = twoNodeSkeleton();
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel2, { head: [10, 20], tail: [30, 40] })])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map(),
      paletteColors: [[1, 2, 3]],
      hasTracks: false,
    });
    expect(trails[0]).toEqual([[20, 30]]);
  });

  it("drops trails with no finite positions (all-invisible instance)", () => {
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [Instance.fromArray([[NaN, NaN]], skel)])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map(),
      paletteColors: [[1, 2, 3]],
      hasTracks: false,
    });
    expect(trails.length).toBe(0);
  });

  it("yields NaN for a node index beyond the instance points", () => {
    const skel2 = twoNodeSkeleton();
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [makeInstance(skel2, { head: [5, 5], tail: [7, 7] })])],
    ]);
    const { trails } = computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [1, 99], // 99 is out of range -> dropped (all-NaN)
      trackIndexMap: new Map(),
      paletteColors: [[1, 2, 3]],
      hasTracks: false,
    });
    expect(trails.length).toBe(1); // only the valid tail target survives
    expect(trails[0]).toEqual([[7, 7]]);
  });

  it("populates and reuses the points cache when provided", () => {
    const track = new Track("A");
    const inst = makeInstance(skel, { c: [10, 10] }, track);
    const frames = new Map<number, LabeledFrame>([
      [0, makeFrame(video, 0, [inst])],
    ]);
    const cache = new Map();
    computeTrails({
      frameIdx: 0,
      frameIdxToLf: frames,
      trailLength: 0,
      trailTargets: [null],
      trackIndexMap: new Map([[track, 0]]),
      paletteColors: [[1, 2, 3]],
      hasTracks: true,
      ptsCache: cache,
    });
    expect(cache.has(inst)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// drawTrails (canvas)
// ---------------------------------------------------------------------------

describe("drawTrails", () => {
  it("draws a polyline (covered pixels become opaque)", async () => {
    const { ctx, read } = await makeCtx(40, 40);
    drawTrails(ctx, [[[10, 10], [10, 30]]], { lineWidth: 6, alphaFade: false });
    const img = read();
    expect(alphaAt(img, 40, 10, 20)).toBeGreaterThan(200); // on the line
    expect(alphaAt(img, 40, 0, 0)).toBe(0); // corner untouched
  });

  it("is a no-op for empty input", async () => {
    const { ctx, read } = await makeCtx(20, 20);
    drawTrails(ctx, []);
    const img = read();
    expect(alphaAt(img, 20, 10, 10)).toBe(0);
  });

  it("is a no-op for single-point trails", async () => {
    const { ctx, read } = await makeCtx(20, 20);
    drawTrails(ctx, [[[10, 10]]], { lineWidth: 6 });
    expect(alphaAt(read(), 20, 10, 10)).toBe(0);
  });

  it("breaks the line at NaN gaps", async () => {
    const { ctx, read } = await makeCtx(40, 60);
    // segment 0: (10,10)-(10,20) drawn; segments touching NaN skipped.
    drawTrails(ctx, [[[10, 10], [10, 20], [NaN, NaN], [10, 40]]], {
      lineWidth: 6,
      alphaFade: false,
    });
    const img = read();
    expect(alphaAt(img, 40, 10, 15)).toBeGreaterThan(200); // drawn segment
    expect(alphaAt(img, 40, 10, 40)).toBe(0); // isolated point: no segment
  });

  it("fades opacity from oldest to newest segment", async () => {
    const { ctx, read } = await makeCtx(40, 80);
    drawTrails(ctx, [[[10, 10], [10, 40], [10, 70]]], { lineWidth: 6 });
    const img = read();
    const older = alphaAt(img, 40, 10, 25); // segment 0 (frac 0.5)
    const newer = alphaAt(img, 40, 10, 55); // segment 1 (frac 1.0)
    expect(older).toBeGreaterThan(0);
    expect(newer).toBeGreaterThan(older);
  });

  it("applies the global alpha multiplier", async () => {
    const half = await makeCtx(40, 40);
    drawTrails(half.ctx, [[[10, 10], [10, 30]]], {
      lineWidth: 6,
      alphaFade: false,
      alpha: 0.5,
    });
    const full = await makeCtx(40, 40);
    drawTrails(full.ctx, [[[10, 10], [10, 30]]], {
      lineWidth: 6,
      alphaFade: false,
      alpha: 1,
    });
    expect(alphaAt(half.read(), 40, 10, 20)).toBeLessThan(
      alphaAt(full.read(), 40, 10, 20)
    );
  });

  it("honors per-trail colors", async () => {
    const { ctx, read } = await makeCtx(50, 40);
    const red: RGB = [255, 0, 0];
    const blue: RGB = [0, 0, 255];
    drawTrails(
      ctx,
      [
        [[10, 10], [10, 30]],
        [[30, 10], [30, 30]],
      ],
      { lineWidth: 6, alphaFade: false, colors: [red, blue] }
    );
    const img = read();
    const [r1, , b1] = rgbaAt(img, 50, 10, 20);
    const [r2, , b2] = rgbaAt(img, 50, 30, 20);
    expect(r1).toBeGreaterThan(b1); // first trail red
    expect(b2).toBeGreaterThan(r2); // second trail blue
  });

  it("throws when colors length does not match trails", async () => {
    const { ctx } = await makeCtx(20, 20);
    expect(() =>
      drawTrails(ctx, [[[1, 1], [2, 2]], [[3, 3], [4, 4]]], {
        colors: [[255, 0, 0]],
      })
    ).toThrow("must be the same length");
  });

  it("applies the offset", async () => {
    const { ctx, read } = await makeCtx(40, 40);
    drawTrails(ctx, [[[20, 10], [20, 30]]], {
      lineWidth: 6,
      alphaFade: false,
      offset: [10, 0],
    });
    const img = read();
    expect(alphaAt(img, 40, 10, 20)).toBeGreaterThan(200); // shifted left by 10
    expect(alphaAt(img, 40, 20, 20)).toBe(0); // original position empty
  });

  it("applies the scale factor", async () => {
    const { ctx, read } = await makeCtx(40, 40);
    drawTrails(ctx, [[[5, 5], [5, 15]]], {
      lineWidth: 4,
      alphaFade: false,
      scale: 2,
    });
    const img = read();
    expect(alphaAt(img, 40, 10, 20)).toBeGreaterThan(200); // scaled to (10,10)-(10,30)
  });

  it("widens the stroke with lineWidth", async () => {
    const thin = await makeCtx(40, 40);
    drawTrails(thin.ctx, [[[10, 5], [10, 35]]], { lineWidth: 1, alphaFade: false });
    const thick = await makeCtx(40, 40);
    drawTrails(thick.ctx, [[[10, 5], [10, 35]]], { lineWidth: 9, alphaFade: false });
    // A pixel offset from the line center is covered only by the thick stroke.
    expect(alphaAt(thin.read(), 40, 13, 20)).toBe(0);
    expect(alphaAt(thick.read(), 40, 13, 20)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// renderImage integration
// ---------------------------------------------------------------------------

describe("renderImage with motion trails", () => {
  const skel = dotSkeleton();

  /** Build a Labels whose rendered frame (labeledFrames[0]) is the newest. */
  function makeTrailLabels(track?: Track): Labels {
    const video = new Video({ filename: "v.mp4" });
    const f0 = makeFrame(video, 0, [makeInstance(skel, { c: [20, 20] }, track)]);
    const f1 = makeFrame(video, 1, [makeInstance(skel, { c: [20, 40] }, track)]);
    const f2 = makeFrame(video, 2, [makeInstance(skel, { c: [20, 60] }, track)]);
    // labeledFrames[0] is the current (newest) frame; trail reaches back to f0.
    return new Labels({ labeledFrames: [f2, f1, f0] });
  }

  it("draws a trail behind the pose for a Labels source", async () => {
    const labels = makeTrailLabels(new Track("A"));
    const withTrails = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 2,
      trailWidth: 5,
    });
    const withoutTrails = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: false,
    });
    // (20,30) sits on the f0->f1 trail segment, away from the f2 pose marker.
    expect(alphaAt(withTrails, 80, 20, 30)).toBeGreaterThan(0);
    expect(alphaAt(withoutTrails, 80, 20, 30)).toBe(0);
  });

  it("overrides trail color when trailColor is set", async () => {
    const labels = makeTrailLabels(new Track("A"));
    const def = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 2,
      trailWidth: 5,
    });
    const red = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 2,
      trailWidth: 5,
      trailColor: "red",
    });
    const [, , bDef] = rgbaAt(def, 80, 20, 30);
    const [rRed, , bRed] = rgbaAt(red, 80, 20, 30);
    expect(bDef).toBeGreaterThan(0); // default palette color is blue-ish
    expect(rRed).toBeGreaterThan(bRed); // explicit red dominates
  });

  it("is a no-op for an instance-array source (no temporal context)", async () => {
    const inst = makeInstance(skel, { c: [40, 40] });
    const img = await renderImage([inst], {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 5,
    });
    expect(img.width).toBe(80);
    expect(img.height).toBe(80);
  });

  it("uses caller-provided trailFrames for a LabeledFrame source", async () => {
    const track = new Track("A");
    const video = new Video({ filename: "v.mp4" });
    const f0 = makeFrame(video, 0, [makeInstance(skel, { c: [20, 20] }, track)]);
    const f1 = makeFrame(video, 1, [makeInstance(skel, { c: [20, 40] }, track)]);
    const f2 = makeFrame(video, 2, [makeInstance(skel, { c: [20, 60] }, track)]);
    const img = await renderImage(f2, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 2,
      trailWidth: 5,
      trailFrames: [f0, f1, f2],
    });
    expect(alphaAt(img, 80, 20, 30)).toBeGreaterThan(0);
  });

  it("supports trailing a named node", async () => {
    const skel2 = twoNodeSkeleton();
    const video = new Video({ filename: "v.mp4" });
    const f0 = makeFrame(video, 0, [
      Instance.fromArray([[20, 20], [60, 60]], skel2),
    ]);
    const f1 = makeFrame(video, 1, [
      Instance.fromArray([[20, 40], [60, 60]], skel2),
    ]);
    const labels = new Labels({ labeledFrames: [f1, f0] });
    const img = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 1,
      trailNode: "head",
      trailWidth: 5,
    });
    // head trail runs along x=20; tail is static at (60,60) so no trail there.
    expect(alphaAt(img, 80, 20, 30)).toBeGreaterThan(0);
  });

  it("draws one trail per node for a node-name list", async () => {
    const skel2 = twoNodeSkeleton();
    const video = new Video({ filename: "v.mp4" });
    // head sweeps down x=20; tail sweeps down x=60.
    const f0 = makeFrame(video, 0, [
      Instance.fromArray([[20, 20], [60, 20]], skel2),
    ]);
    const f1 = makeFrame(video, 1, [
      Instance.fromArray([[20, 50], [60, 50]], skel2),
    ]);
    const labels = new Labels({ labeledFrames: [f1, f0] });
    const img = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 1,
      trailNode: ["head", "tail"],
      trailWidth: 5,
    });
    expect(alphaAt(img, 80, 20, 35)).toBeGreaterThan(0); // head trail
    expect(alphaAt(img, 80, 60, 35)).toBeGreaterThan(0); // tail trail
  });

  it("accepts a numeric (grayscale) trailColor", async () => {
    const labels = makeTrailLabels(new Track("A"));
    const img = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 2,
      trailWidth: 5,
      trailColor: 200,
    });
    const [r, g, b] = rgbaAt(img, 80, 20, 30);
    expect(r).toBeGreaterThan(150);
    expect(Math.abs(r - g)).toBeLessThan(20);
    expect(Math.abs(r - b)).toBeLessThan(20);
  });

  it("renders trails on an empty current frame (Python PR #434 parity)", async () => {
    const track = new Track("A");
    const video = new Video({ filename: "v.mp4" });
    const f1 = makeFrame(video, 1, [makeInstance(skel, { c: [20, 30] }, track)]);
    const f2 = makeFrame(video, 2, [makeInstance(skel, { c: [20, 50] }, track)]);
    const f3 = makeFrame(video, 3, []); // current frame is empty
    const labels = new Labels({
      labeledFrames: [f3, f2, f1],
      videos: [video],
      skeletons: [skel],
      tracks: [track],
    });
    // Without trails this would throw ("No instances to render"); trails relax it.
    const img = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 3,
      trailWidth: 5,
    });
    expect(alphaAt(img, 80, 20, 40)).toBeGreaterThan(0); // on the f1->f2 segment
  });

  it("trails predicted instances", async () => {
    const track = new Track("A");
    const video = new Video({ filename: "v.mp4" });
    const f0 = makeFrame(video, 0, [
      new PredictedInstance({ points: { c: [20, 20] }, skeleton: skel, track, score: 0.9 }),
    ]);
    const f1 = makeFrame(video, 1, [
      new PredictedInstance({ points: { c: [20, 50] }, skeleton: skel, track, score: 0.8 }),
    ]);
    const labels = new Labels({ labeledFrames: [f1, f0] });
    const img = await renderImage(labels, {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 1,
      trailWidth: 5,
    });
    expect(alphaAt(img, 80, 20, 35)).toBeGreaterThan(0);
  });

  it("honors trailTracks ordering (the renderVideo per-frame contract)", async () => {
    // Render the same LabeledFrame twice with different canonical track orders;
    // the trail color must follow the track's index in trailTracks.
    const a = new Track("A");
    const b = new Track("B");
    const video = new Video({ filename: "v.mp4" });
    const f0 = makeFrame(video, 0, [makeInstance(skel, { c: [20, 20] }, a)]);
    const f1 = makeFrame(video, 1, [makeInstance(skel, { c: [20, 50] }, a)]);
    const common = {
      width: 80,
      height: 80,
      showTrails: true,
      trailLength: 1,
      trailWidth: 5,
      trailFrames: [f0, f1],
    } as const;
    // trailTracks [A, B]: A -> palette index 0.
    const aFirst = await renderImage(f1, { ...common, trailTracks: [a, b] });
    // trailTracks [B, A]: A -> palette index 1 (different color).
    const bFirst = await renderImage(f1, { ...common, trailTracks: [b, a] });
    const c0 = rgbaAt(aFirst, 80, 20, 35);
    const c1 = rgbaAt(bFirst, 80, 20, 35);
    expect(c0[0] !== c1[0] || c0[1] !== c1[1] || c0[2] !== c1[2]).toBe(true);
  });
});
