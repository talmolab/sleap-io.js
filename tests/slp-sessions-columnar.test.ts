/**
 * SLP 2.8 columnar /session_data — streaming read (Phase 3) + round-trip coverage.
 *
 * Port of talmolab/sleap-io#546: 3D session data lives in a columnar /session_data
 * group. These tests cover the streaming/worker read path, NaN keypoint
 * preservation, the null→NaN legacy-read repair (luc3d#161), multi-session global
 * offsets, per-row metadata blobs, and format-version gating.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readSessionsStreaming } from "../src/codecs/slp/read-streaming.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { reconstructInstance3D } from "../src/codecs/slp/parsers.js";
import {
  Camera,
  CameraGroup,
  InstanceGroup,
  FrameGroup,
  RecordingSession,
  injectSessionFrameResolver,
} from "../src/model/camera.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance3D, PredictedInstance3D } from "../src/model/instance3d.js";
import { Identity } from "../src/model/identity.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { ready, File as H5File } from "h5wasm/node";

const SKELETON = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });

/** Build a single- or multi-session Labels with 3D instance groups. */
function make3dLabels(opts?: {
  predicted?: boolean;
  points?: number[][];
  score?: number;
  identity?: Identity;
  fgMeta?: Record<string, unknown>;
  igMeta?: Record<string, unknown>;
  nSessions?: number;
}): Labels {
  const nSessions = opts?.nSessions ?? 1;
  const points = opts?.points ?? [
    [50, 100, 200],
    [150, 300, 400],
  ];
  const labeledFrames: LabeledFrame[] = [];
  const videos: Video[] = [];
  const sessions: RecordingSession[] = [];

  for (let s = 0; s < nSessions; s++) {
    const v1 = new Video({ filename: `s${s}_cam1.mp4` });
    const v2 = new Video({ filename: `s${s}_cam2.mp4` });
    videos.push(v1, v2);
    const cam1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const cam2 = new Camera({ name: "cam2", rvec: [0, 0, 0], tvec: [s, 0, 0] });
    // Offset the 3D points per session so we can verify per-session slicing.
    const p = points.map((row) => row.map((c) => c + s * 1000));
    const inst1 = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      SKELETON,
    );
    const inst2 = Instance.fromArray(
      [
        [5, 6],
        [7, 8],
      ],
      SKELETON,
    );
    const lf1 = new LabeledFrame({
      video: v1,
      frameIdx: 0,
      instances: [inst1],
    });
    const lf2 = new LabeledFrame({
      video: v2,
      frameIdx: 0,
      instances: [inst2],
    });
    labeledFrames.push(lf1, lf2);
    const instance3d = opts?.predicted
      ? new PredictedInstance3D({
          points: p,
          skeleton: SKELETON,
          score: opts?.score ?? 0.9,
          pointScores: [0.95, 0.88],
        })
      : new Instance3D({
          points: p,
          skeleton: SKELETON,
          score: opts?.score ?? 0.9,
        });
    const ig = new InstanceGroup({
      instanceByCamera: new Map([
        [cam1, inst1],
        [cam2, inst2],
      ]),
      instance3d,
      identity: opts?.identity,
      metadata: opts?.igMeta,
    });
    const fg = new FrameGroup({
      frameIdx: 0,
      instanceGroups: [ig],
      labeledFrameByCamera: new Map([
        [cam1, lf1],
        [cam2, lf2],
      ]),
      metadata: opts?.fgMeta,
    });
    const session = new RecordingSession({
      cameraGroup: new CameraGroup({ cameras: [cam1, cam2] }),
    });
    session.addVideo(v1, cam1);
    session.addVideo(v2, cam2);
    session.frameGroups.set(0, fg);
    sessions.push(session);
  }

  return new Labels({
    labeledFrames,
    videos,
    skeletons: [SKELETON],
    sessions,
    identities: opts?.identity ? [opts.identity] : [],
  });
}

/** Back a StreamingH5File with a real h5wasm/node file opened from `bytes`. */
async function makeStreamingFake(
  bytes: Uint8Array,
): Promise<{ fake: StreamingH5File; close: () => void }> {
  const module = await ready;
  try {
    module.FS.mkdir("/tmp");
  } catch {
    /* exists */
  }
  const p = `/tmp/colstream_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}.slp`;
  module.FS.writeFile(p, bytes);
  const h5 = new H5File(p, "r");
  const get = (dp: string) => h5.get(dp) as any;
  const fake = {
    keys: () => h5.keys() as string[],
    getKeys: async (dp: string) => {
      const g = get(dp);
      return typeof g?.keys === "function" ? (g.keys() as string[]) : [];
    },
    getAttrs: async (dp: string) => {
      const a = (get(dp)?.attrs as Record<string, any>) ?? {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) out[k] = v?.value ?? v;
      return out;
    },
    getDatasetMeta: async (dp: string) => {
      const d = get(dp);
      return {
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
    getDatasetValue: async (dp: string) => {
      const d = get(dp);
      return {
        value: d?.value,
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
  } as unknown as StreamingH5File;
  return {
    fake,
    close: () => {
      h5.close();
      try {
        module.FS.unlink(p);
      } catch {
        /* ignore */
      }
    },
  };
}

describe("SLP 2.8 columnar sessions", () => {
  it("streaming reader reconstructs columnar 3D (matches eager)", async () => {
    const labels = make3dLabels({ predicted: true, score: 0.92 });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));

    const eager = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });

    const { fake, close } = await makeStreamingFake(bytes);
    try {
      const streamed = await readSessionsStreaming(
        fake,
        eager.videos,
        eager.skeletons,
        eager.identities,
      );
      // Wrap in Labels + inject resolver so member refs resolve to instances.
      const streamedLabels = new Labels({
        labeledFrames: eager.labeledFrames,
        videos: eager.videos,
        skeletons: eager.skeletons,
        sessions: streamed,
      });
      injectSessionFrameResolver(streamedLabels);

      expect(streamed).toHaveLength(1);
      const ig = streamed[0].frameGroups.get(0)!.instanceGroups[0];
      expect(ig.instance3d).toBeInstanceOf(PredictedInstance3D);
      expect(ig.instance3d!.points).toEqual([
        [50, 100, 200],
        [150, 300, 400],
      ]);
      expect(ig.instance3d!.score).toBe(0.92);
      expect((ig.instance3d as PredictedInstance3D).pointScores).toEqual([
        0.95, 0.88,
      ]);
      // Members resolve to the two camera instances.
      expect(ig.instanceByCamera.size).toBe(2);
    } finally {
      close();
    }
  });

  it("preserves NaN 3D keypoints (missing) natively", async () => {
    const labels = make3dLabels({
      points: [
        [Number.NaN, Number.NaN, Number.NaN],
        [10, 20, 30],
      ],
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const pts =
      loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0].instance3d!
        .points!;
    expect(pts[0].every((c) => Number.isNaN(c))).toBe(true);
    expect(pts[1]).toEqual([10, 20, 30]);
  });

  it("repairs legacy inline null 3D keypoints to NaN on read (luc3d#161)", () => {
    // reconstructInstance3D is the legacy (<=2.7) inline path; a missing keypoint
    // serialized as JSON null must become a NaN row, not Number(null)=0.
    const i3d = reconstructInstance3D(
      {
        points: [null, [1, 2, 3], [null, 5, null]],
        instance_3d_score: 0.7,
      },
      [SKELETON],
    );
    expect(i3d).toBeInstanceOf(Instance3D);
    const pts = i3d!.points!;
    expect(pts[0].every((c) => Number.isNaN(c))).toBe(true);
    expect(pts[1]).toEqual([1, 2, 3]);
    expect(Number.isNaN(pts[2][0])).toBe(true);
    expect(pts[2][1]).toBe(5);
    expect(Number.isNaN(pts[2][2])).toBe(true);
  });

  it("gives each session its own points via global row offsets", async () => {
    const labels = make3dLabels({ nSessions: 2 });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    expect(loaded.sessions).toHaveLength(2);
    // Session 0 keeps its points; session 1 is offset by +1000 (see builder).
    expect(
      loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0].instance3d!
        .points,
    ).toEqual([
      [50, 100, 200],
      [150, 300, 400],
    ]);
    expect(
      loaded.sessions[1].frameGroups.get(0)!.instanceGroups[0].instance3d!
        .points,
    ).toEqual([
      [1050, 1100, 1200],
      [1150, 1300, 1400],
    ]);
  });

  it("round-trips per-row frame-group + instance-group metadata", async () => {
    const labels = make3dLabels({
      fgMeta: { note: "fg-meta", n: 7 },
      igMeta: { tag: "ig-meta", ok: true },
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const fg = loaded.sessions[0].frameGroups.get(0)!;
    expect(fg.metadata).toEqual({ note: "fg-meta", n: 7 });
    expect(fg.instanceGroups[0].metadata).toEqual({ tag: "ig-meta", ok: true });
  });

  it("round-trips an InstanceGroup identity via identity_idx", async () => {
    const identity = new Identity({ name: "mouse_A" });
    const labels = make3dLabels({ identity });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const ig = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(ig.identity).toBe(loaded.identities[0]);
    expect(loaded.identities[0].name).toBe("mouse_A");
  });

  it("session with no frame groups writes no /session_data and stays below 2.8", async () => {
    const video = new Video({ filename: "cam.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const session = new RecordingSession({
      cameraGroup: new CameraGroup({ cameras: [cam] }),
    });
    session.addVideo(video, cam);
    const labels = new Labels({
      labeledFrames: [],
      videos: [video],
      skeletons: [SKELETON],
      sessions: [session],
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const { file, close } = await (
      await import("../src/codecs/slp/h5.js")
    ).openH5File(bytes.buffer as ArrayBuffer);
    try {
      expect(file.get("session_data")).toBeNull();
      const attrs = (file.get("metadata") as any).attrs ?? {};
      const formatId = Number(attrs.format_id?.value ?? attrs.format_id);
      expect(formatId).toBeLessThan(2.8);
    } finally {
      close();
    }
    // Calibration still round-trips (session present, just no frame groups).
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].cameraGroup.cameras).toHaveLength(1);
  });

  it("lazy re-save preserves columnar 3D + frame groups (ref-based, no materialization)", async () => {
    // The lazy read reconstructs frame groups from /session_data (member index refs
    // + 3D points in memory) without materializing frames; the lazy write path then
    // re-serializes them from those refs. This should round-trip 3D + grouping
    // losslessly WITHOUT a verbatim passthrough (unlike Python, which needs one).
    const labels = make3dLabels({ predicted: true, score: 0.77 });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));

    const lazy = await readSlpLazy(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    // No frames materialized by reading/holding the sessions.
    expect(lazy._lazyFrameList?.materializedCount ?? 0).toBe(0);

    const resaved = new Uint8Array(await saveSlpToBytes(lazy));
    const loaded = await readSlp(resaved.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const ig = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(ig.instance3d).toBeInstanceOf(PredictedInstance3D);
    expect(ig.instance3d!.points).toEqual([
      [50, 100, 200],
      [150, 300, 400],
    ]);
    expect(ig.instance3d!.score).toBe(0.77);
    expect((ig.instance3d as PredictedInstance3D).pointScores).toEqual([
      0.95, 0.88,
    ]);
    expect(ig.instanceByCamera.size).toBe(2);
  });

  it("lite (jsfive) reader surfaces columnar 3D via SessionMetadata.frameGroups", async () => {
    const { loadSlpMetadata } = await import("../src/lite.js");
    const labels = make3dLabels({
      predicted: true,
      score: 0.81,
      igMeta: { tag: "z" },
      fgMeta: { fnote: 1 },
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));

    const meta = await loadSlpMetadata(bytes.buffer as ArrayBuffer);
    expect(meta.sessions).toHaveLength(1);
    const fgs = meta.sessions[0].frameGroups;
    expect(fgs).toBeDefined();
    expect(fgs!).toHaveLength(1);
    expect(fgs![0].frameIdx).toBe(0);
    expect(fgs![0].metadata).toEqual({ fnote: 1 });
    const ig = fgs![0].instanceGroups[0];
    expect(ig.instance3d).toBeInstanceOf(PredictedInstance3D);
    expect(ig.instance3d!.points).toEqual([
      [50, 100, 200],
      [150, 300, 400],
    ]);
    expect(ig.instance3d!.score).toBe(0.81);
    expect((ig.instance3d as PredictedInstance3D).pointScores).toEqual([
      0.95, 0.88,
    ]);
    expect(ig.metadata).toEqual({ tag: "z" });
  });

  it("reads a Python-written 2.8 file (genuine compound tables, i8/u8 indices)", async () => {
    // Cross-language: Python writes /session_data as true HDF5 compound datasets
    // (i8/u8/i4/u1 mixed dtypes) rather than the JS flat-2D+field_names form. The
    // reader must handle both (compound via readCompoundColumnsManual, i8/u8 -> Number).
    const { fileURLToPath } = await import("node:url");
    const { readFileSync } = await import("node:fs");
    const nodePath = await import("node:path");
    const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
    const p = nodePath.join(
      fixtureRoot,
      "slp",
      "py_written_28_multiview3d.slp",
    );
    const bytes = readFileSync(p);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });

    expect(loaded.sessions).toHaveLength(1);
    const s = loaded.sessions[0];
    expect(s.cameraGroup.cameras).toHaveLength(2);
    const fg = s.frameGroups.get(0)!;
    expect(fg.metadata).toEqual({ fnote: "hi" });
    const ig = fg.instanceGroups[0];
    expect(ig.metadata).toEqual({ app: "lucid", n: 7 });
    expect(ig.instance3d).toBeInstanceOf(PredictedInstance3D);
    const pts = ig.instance3d!.points!;
    // Full float64 precision + NaN missing keypoint survive cross-language.
    expect(pts[0]).toEqual([121.57910322579006, 2.5, 3.5]);
    expect(pts[1].every((c) => Number.isNaN(c))).toBe(true);
    expect(ig.instance3d!.score).toBe(0.9200000001);
    const ps = (ig.instance3d as PredictedInstance3D).pointScores!;
    expect(ps[0]).toBe(0.95);
    expect(Number.isNaN(ps[1])).toBe(true);
    // Member index refs resolved to the two per-camera instances.
    expect(ig.instanceByCamera.size).toBe(2);
  });

  it("lite reader leaves frameGroups unset for a legacy (no /session_data) file", async () => {
    const { loadSlpMetadata } = await import("../src/lite.js");
    // A session with no frame groups writes no /session_data (and no fg range).
    const video = new Video({ filename: "cam.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const session = new RecordingSession({
      cameraGroup: new CameraGroup({ cameras: [cam] }),
    });
    session.addVideo(video, cam);
    const labels = new Labels({
      labeledFrames: [],
      videos: [video],
      skeletons: [SKELETON],
      sessions: [session],
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const meta = await loadSlpMetadata(bytes.buffer as ArrayBuffer);
    expect(meta.sessions).toHaveLength(1);
    expect(meta.sessions[0].frameGroups).toBeUndefined();
    expect(meta.sessions[0].cameras).toHaveLength(1);
  });
});
