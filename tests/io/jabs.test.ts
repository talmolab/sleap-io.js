/**
 * Tests for the JABS pose-file reader (`src/io/jabs.ts`).
 *
 * Mirrors the reader-relevant cases from the Python suite
 * `tests/io/test_jabs.py` (the writer half — `convert_labels` / `write_jabs_v*`
 * — is intentionally out of scope per issue #99). Uses the real JABS fixtures
 * copied verbatim from the Python repo: `example_pose_est_v2.h5` (single mouse,
 * 100 frames) and `example_pose_est_v5.h5` (multi-mouse, 250 frames, with arena
 * corners as a static object).
 */
import { describe, it, expect } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadJabs,
  predictionToInstance,
  makeSimpleSkeleton,
  staticObjectToRoi,
  makeJabsDefaultSkeleton,
  JABS_DEFAULT_SKELETON,
  JABS_DEFAULT_KEYPOINT_NAMES,
} from "../../src/io/jabs.js";
import { Labels } from "../../src/model/labels.js";
import { PredictedInstance } from "../../src/model/instance.js";
import { Skeleton, Node } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";

const jabsDir = fileURLToPath(new URL("../data/jabs", import.meta.url));
const v2Path = path.join(jabsDir, "example_pose_est_v2.h5");
const v5Path = path.join(jabsDir, "example_pose_est_v5.h5");

// ===========================================================================
// Default skeleton
// ===========================================================================

describe("JABS default skeleton", () => {
  it("has the 12-node Mouse structure with edges + symmetries", () => {
    const sk = JABS_DEFAULT_SKELETON;
    expect(sk.name).toBe("Mouse");
    expect(sk.nodes.length).toBe(12);
    expect(sk.edges.length).toBe(11);
    expect(sk.symmetries.length).toBe(3);
    expect(sk.nodes.map((n) => n.name)).toEqual([...JABS_DEFAULT_KEYPOINT_NAMES]);
  });

  it("makeJabsDefaultSkeleton returns a fresh equivalent skeleton", () => {
    const a = makeJabsDefaultSkeleton();
    const b = makeJabsDefaultSkeleton();
    expect(a).not.toBe(b);
    expect(a.nodes.length).toBe(12);
    expect(a.matches(b)).toBe(true);
  });
});

// ===========================================================================
// loadJabs — v5 (multi-mouse)
// ===========================================================================

describe("loadJabs (v5 multi-mouse)", () => {
  it("returns a Labels with 250 frames and a single Mouse skeleton", async () => {
    const labels = await loadJabs(v5Path);
    expect(labels).toBeInstanceOf(Labels);
    expect(labels.labeledFrames.length).toBe(250);
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].name).toBe("Mouse");
  });

  it("creates only PredictedInstance objects, all with positive score", async () => {
    const labels = await loadJabs(v5Path);
    let count = 0;
    for (const lf of labels.labeledFrames) {
      for (const inst of lf.instances) {
        expect(inst).toBeInstanceOf(PredictedInstance);
        expect((inst as PredictedInstance).score).toBeGreaterThan(0);
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("preserves per-point confidence on visible keypoints", async () => {
    const labels = await loadJabs(v5Path);
    const inst = labels.labeledFrames[0].instances[0] as PredictedInstance;
    expect(inst).toBeInstanceOf(PredictedInstance);
    const visible = inst.points.filter((p) => p.visible);
    expect(visible.length).toBeGreaterThan(0);
    for (const p of visible) {
      expect(p.score).toBeGreaterThan(0);
    }
  });

  it("assigns tracks from the embedded identities", async () => {
    const labels = await loadJabs(v5Path);
    // The v5 fixture has 4 long-term identities (1–4).
    expect(labels.tracks.length).toBe(4);
    const names = new Set(labels.tracks.map((t) => t.name));
    expect(names).toEqual(new Set(["1", "2", "3", "4"]));
  });

  it("loads v5 static objects as static ROIs (PR #371 behavior)", async () => {
    const labels = await loadJabs(v5Path);
    // No synthetic skeletons — only Mouse.
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].name).toBe("Mouse");

    // Single static object: arena corners.
    expect(labels.rois.length).toBe(1);
    expect(labels.staticRois.length).toBe(1);
    const roi = labels.rois[0];
    expect(roi.name).toBe("corners");
    expect(roi.category).toBe("arena");
    expect(roi.source).toBe("jabs");
    expect(roi.video).toBe(labels.videos[0]); // static ROI keeps the video reference
    expect(roi.geometry.type).toBe("MultiPoint");
    expect((roi.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [58, 61],
      [175, 773],
      [648, 44],
      [714, 776],
    ]);
  });

  it("flips JABS (y, x) coordinates to (x, y)", async () => {
    const labels = await loadJabs(v5Path);
    // Frame 0, first instance, first node: raw stored (y=247, x=99).
    const inst = labels.labeledFrames[0].instances[0];
    const nose = inst.points[0];
    expect(nose.xy[0]).toBe(99); // x
    expect(nose.xy[1]).toBe(247); // y
  });

  it("records the source filename in provenance", async () => {
    const labels = await loadJabs(v5Path);
    expect(labels.provenance.filename).toBe(v5Path);
  });

  it("derives the video name from the pose-file name", async () => {
    const labels = await loadJabs(v5Path);
    expect(labels.videos[0].filename).toBe(path.join(jabsDir, "example.avi"));
  });

  it("accepts a custom skeleton override", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => new Node(`custom_${i}`));
    const custom = new Skeleton({ nodes, name: "custom" });
    const labels = await loadJabs(v5Path, { skeleton: custom });
    expect(labels.skeletons[0]).toBe(custom);
    for (const lf of labels.labeledFrames) {
      for (const inst of lf.instances) {
        expect(inst.skeleton).toBe(custom);
      }
    }
  });
});

// ===========================================================================
// loadJabs — v2 (single mouse)
// ===========================================================================

describe("loadJabs (v2 single-mouse)", () => {
  it("returns 100 frames with a single Mouse track", async () => {
    const labels = await loadJabs(v2Path);
    expect(labels.labeledFrames.length).toBe(100);
    expect(labels.skeletons.map((s) => s.name)).toEqual(["Mouse"]);
    expect(labels.tracks.map((t) => t.name)).toEqual(["1"]);
  });

  it("creates a single PredictedInstance per populated frame", async () => {
    const labels = await loadJabs(v2Path);
    const inst = labels.labeledFrames[0].instances[0];
    expect(inst).toBeInstanceOf(PredictedInstance);
    expect((inst as PredictedInstance).score).toBeGreaterThan(0);
    expect(inst.track?.name).toBe("1");
    for (const lf of labels.labeledFrames) {
      expect(lf.instances.length).toBeLessThanOrEqual(1);
    }
  });

  it("has no static ROIs in v2", async () => {
    const labels = await loadJabs(v2Path);
    expect(labels.rois.length).toBe(0);
  });
});

// ===========================================================================
// Error handling
// ===========================================================================

describe("loadJabs errors", () => {
  it("throws for a missing file", async () => {
    const missing = path.join(os.tmpdir(), "definitely-not-a-jabs-file-xyz.h5");
    await expect(loadJabs(missing)).rejects.toThrow(/doesn't exist/);
  });
});

// ===========================================================================
// predictionToInstance
// ===========================================================================

describe("predictionToInstance", () => {
  it("creates a PredictedInstance with mean score and per-point scores", () => {
    const data = Array.from({ length: 12 }, (_, i) => [i * 10, i * 5]);
    const conf = new Array(12).fill(0);
    conf[0] = 0.8;
    conf[3] = 0.6;
    const inst = predictionToInstance(data, conf, JABS_DEFAULT_SKELETON);
    expect(inst).not.toBeNull();
    expect(inst).toBeInstanceOf(PredictedInstance);
    expect(inst!.score).toBeCloseTo(0.7, 6); // mean(0.8, 0.6)
    // Present points carry their confidence; absent points are invisible.
    expect(inst!.points[0].visible).toBe(true);
    expect(inst!.points[0].score).toBeCloseTo(0.8, 6);
    expect(inst!.points[0].xy).toEqual([0, 0]);
    expect(inst!.points[3].visible).toBe(true);
    expect(inst!.points[3].score).toBeCloseTo(0.6, 6);
    expect(inst!.points[1].visible).toBe(false);
    expect(Number.isNaN(inst!.points[1].xy[0])).toBe(true);
  });

  it("returns null when no keypoint has positive confidence", () => {
    const data = Array.from({ length: 12 }, () => [0, 0]);
    const conf = new Array(12).fill(0);
    expect(predictionToInstance(data, conf, JABS_DEFAULT_SKELETON)).toBeNull();
  });

  it("throws when the skeleton size does not match the keypoints", () => {
    const data = Array.from({ length: 5 }, () => [0, 0]);
    const conf = new Array(5).fill(1);
    expect(() => predictionToInstance(data, conf, JABS_DEFAULT_SKELETON)).toThrow();
  });
});

// ===========================================================================
// makeSimpleSkeleton
// ===========================================================================

describe("makeSimpleSkeleton", () => {
  it("creates a line skeleton of the requested size", () => {
    const sk = makeSimpleSkeleton("test", 2);
    expect(sk.nodes.length).toBe(2);
    expect(sk.edges.length).toBe(1);
    expect(sk.name).toBe("test");
  });
});

// ===========================================================================
// staticObjectToRoi
// ===========================================================================

describe("staticObjectToRoi", () => {
  it("creates a Point ROI for single-point objects (e.g., lixit)", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const roi = staticObjectToRoi("lixit", [[100, 200]], video);
    expect(roi.name).toBe("lixit");
    expect(roi.category).toBe("anchor");
    expect(roi.source).toBe("jabs");
    expect(roi.geometry.type).toBe("Point");
    expect((roi.geometry as { coordinates: number[] }).coordinates).toEqual([100, 200]);
    expect(roi.video).toBe(video);
  });

  it("creates a MultiPoint ROI with category arena for corners", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const roi = staticObjectToRoi(
      "corners",
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      video,
    );
    expect(roi.category).toBe("arena");
    expect(roi.geometry.type).toBe("MultiPoint");
    expect((roi.geometry as { coordinates: number[][] }).coordinates.length).toBe(4);
  });
});
