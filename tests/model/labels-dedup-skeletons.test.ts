import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { loadSlp, saveSlpToBytes } from "../../src/io/main.js";

function skel(names: string[], name?: string): Skeleton {
  return new Skeleton({ nodes: names, name });
}

describe("Labels.dedupSkeletons", () => {
  it("returns 0 on empty Labels", () => {
    const labels = new Labels({});
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(labels.skeletons).toHaveLength(0);
  });

  it("returns 0 with a single skeleton", () => {
    const s = skel(["a", "b"]);
    const labels = new Labels({ skeletons: [s] });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(labels.skeletons).toEqual([s]);
  });

  it("collapses two equal-but-distinct skeletons and reassigns instances", () => {
    const sA = skel(["head", "thorax"], "A");
    const sB = skel(["head", "thorax"], "B");
    const video = new Video({ filename: "v.mp4" });
    const instA = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      sA,
    );
    const instB = Instance.fromArray(
      [
        [5, 6],
        [7, 8],
      ],
      sB,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [sA, sB],
    });

    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 1 });
    expect(labels.skeletons).toEqual([sA]);
    expect(instA.skeleton).toBe(sA);
    expect(instB.skeleton).toBe(sA);
    // Point coords unchanged
    expect(instA.points[0].xy).toEqual([1, 2]);
    expect(instB.points[0].xy).toEqual([5, 6]);
    expect(instB.points[1].xy).toEqual([7, 8]);
  });

  it("partitions three equivalence classes with multiple members", () => {
    const a1 = skel(["x", "y"], "a1");
    const a2 = skel(["x", "y"], "a2");
    const b1 = skel(["p", "q", "r"], "b1");
    const b2 = skel(["p", "q", "r"], "b2");
    const c1 = skel(["m"], "c1");
    const c2 = skel(["m"], "c2");
    const video = new Video({ filename: "v.mp4" });
    const instances = [
      Instance.fromArray(
        [
          [1, 1],
          [2, 2],
        ],
        a2,
      ),
      Instance.fromArray(
        [
          [3, 3],
          [4, 4],
          [5, 5],
        ],
        b2,
      ),
      Instance.fromArray([[6, 6]], c2),
    ];
    const frame = new LabeledFrame({ video, frameIdx: 0, instances });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [a1, a2, b1, b2, c1, c2],
    });

    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 3 });
    expect(labels.skeletons).toEqual([a1, b1, c1]);
    expect(instances[0].skeleton).toBe(a1);
    expect(instances[1].skeleton).toBe(b1);
    expect(instances[2].skeleton).toBe(c1);
  });

  it("does not merge skeletons with different node names", () => {
    const s1 = skel(["a", "b"]);
    const s2 = skel(["a", "c"]);
    const labels = new Labels({ skeletons: [s1, s2] });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(labels.skeletons).toEqual([s1, s2]);
  });

  it("does not merge skeletons with same names in different order (matches() is order-sensitive)", () => {
    const s1 = skel(["a", "b"]);
    const s2 = skel(["b", "a"]);
    const labels = new Labels({ skeletons: [s1, s2] });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(labels.skeletons).toEqual([s1, s2]);
  });

  it("dedups unreferenced skeletons against their peers", () => {
    const s1 = skel(["a", "b"], "s1");
    const s2 = skel(["a", "b"], "s2");
    const labels = new Labels({ skeletons: [s1, s2] });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 1 });
    expect(labels.skeletons).toEqual([s1]);
  });

  it("is idempotent", () => {
    const sA = skel(["head", "thorax"]);
    const sB = skel(["head", "thorax"]);
    const labels = new Labels({ skeletons: [sA, sB] });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 1 });
    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(labels.skeletons).toEqual([sA]);
  });

  it("is a no-op on a copied Labels (clones are 1-per-equivalence-class)", () => {
    const s = skel(["head", "thorax"], "fly");
    const video = new Video({ filename: "v.mp4" });
    const instance = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      s,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instance],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [s],
    });
    const copy = labels.copy();
    expect(copy.skeletons).toHaveLength(1);
    expect(copy.dedupSkeletons()).toEqual({ canonicalized: 0 });
    expect(copy.skeletons).toHaveLength(1);
  });

  it("handles predicted instances", () => {
    const sA = skel(["head", "thorax"], "A");
    const sB = skel(["head", "thorax"], "B");
    const video = new Video({ filename: "v.mp4" });
    const pred = PredictedInstance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      sB,
      0.9,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [pred],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [sA, sB],
    });

    expect(labels.dedupSkeletons()).toEqual({ canonicalized: 1 });
    expect(labels.skeletons).toEqual([sA]);
    expect(pred.skeleton).toBe(sA);
  });
});

describe("loadSlp does not auto-dedup skeletons (helper is opt-in)", () => {
  it("preserves duplicate skeletons through save+load, then collapses on explicit call", async () => {
    const sA = skel(["head", "thorax"], "A");
    const sB = skel(["head", "thorax"], "B");
    const video = new Video({ filename: "v.mp4" });
    const instA = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      sA,
    );
    const instB = Instance.fromArray(
      [
        [5, 6],
        [7, 8],
      ],
      sB,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [sA, sB],
    });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await loadSlp(bytes, { openVideos: false });

    // Auto-dedup is intentionally NOT performed on load.
    expect(loaded.skeletons).toHaveLength(2);

    // Explicit call collapses them.
    expect(loaded.dedupSkeletons()).toEqual({ canonicalized: 1 });
    expect(loaded.skeletons).toHaveLength(1);
    for (const inst of loaded.instances) {
      expect(loaded.skeletons).toContain(inst.skeleton);
    }
  });

  it("materializes lazy mode before deduping", async () => {
    const sA = skel(["head", "thorax"], "A");
    const sB = skel(["head", "thorax"], "B");
    const video = new Video({ filename: "v.mp4" });
    const instA = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      sA,
    );
    const instB = Instance.fromArray(
      [
        [5, 6],
        [7, 8],
      ],
      sB,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
    });
    const source = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [sA, sB],
    });
    const bytes = await saveSlpToBytes(source);
    const lazy = await loadSlp(bytes, { openVideos: false, lazy: true });

    expect(lazy.isLazy).toBe(true);
    expect(lazy.skeletons).toHaveLength(2);

    expect(lazy.dedupSkeletons()).toEqual({ canonicalized: 1 });

    expect(lazy.isLazy).toBe(false);
    expect(lazy.skeletons).toHaveLength(1);
    for (const inst of lazy.instances) {
      expect(lazy.skeletons).toContain(inst.skeleton);
    }
  });
});
