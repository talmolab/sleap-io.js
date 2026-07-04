/**
 * Raw sessions_json surface (issue #197).
 *
 * Verifies the verbatim parsed sessions_json dict is surfaced on read via
 * `RecordingSession.rawJson` and the derived `Labels.rawSessionsJson` getter,
 * across eager / lazy / streaming read paths, WITHOUT introducing any new
 * on-disk storage (the write path is byte-for-byte unchanged and never
 * references rawJson).
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import {
  readSlpStreaming,
  readSessionsStreaming,
} from "../src/codecs/slp/read-streaming.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const MULTIVIEW = path.join(fixtureRoot, "slp", "multiview.slp");

/** Read the raw sessions_json entries and /metadata `json` attr via h5wasm. */
async function inspectSessions(bytes: Uint8Array): Promise<{
  sessionsJson: Array<Record<string, unknown>>;
  metadataJson: string;
}> {
  const module = await ready;
  const p = `/tmp/raw_sessions_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}.slp`;
  module.FS.writeFile(p, bytes);
  const file = new H5File(p, "r");
  try {
    const keys = file.keys() as string[];
    const sessionsJson = keys.includes("sessions_json")
      ? (file.get("sessions_json") as { value: string[] }).value.map((s) =>
          JSON.parse(s),
        )
      : [];
    const meta = file.get("metadata") as {
      attrs: Record<string, { value?: unknown }>;
    };
    const rawAttr = meta.attrs.json?.value ?? meta.attrs.json;
    const metadataJson =
      typeof rawAttr === "string"
        ? rawAttr
        : rawAttr instanceof Uint8Array
          ? new TextDecoder().decode(rawAttr)
          : String(rawAttr ?? "");
    return { sessionsJson, metadataJson };
  } finally {
    file.close();
    module.FS.unlink(p);
  }
}

/** Whether the in-Worker streaming reader is usable in this runtime. */
async function streamingWorks(): Promise<boolean> {
  try {
    await readSlpStreaming(
      new Uint8Array(readFileSync(MULTIVIEW)).buffer as ArrayBuffer,
      { openVideos: false, filenameHint: "multiview.slp" },
    );
    return true;
  } catch {
    return false;
  }
}

describe("Raw sessions_json surface (#197)", () => {
  it("exposes verbatim rawJson on eager read", async () => {
    const labels = await readSlp(MULTIVIEW, { openVideos: false });
    expect(labels.sessions.length).toBeGreaterThan(0);

    // Derived getter is index-aligned with sessions and fully populated.
    expect(labels.rawSessionsJson.length).toBe(labels.sessions.length);
    for (const entry of labels.rawSessionsJson) {
      expect(entry).toBeDefined();
    }
    expect(labels.rawSessionsJson[0]).toBe(labels.sessions[0].rawJson);

    const raw = labels.sessions[0].rawJson!;
    expect(Object.hasOwn(raw, "calibration")).toBe(true);
    expect(Object.hasOwn(raw, "camcorder_to_video_idx_map")).toBe(true);

    // Byte-verbatim vs the on-disk dataset (second h5wasm open).
    const { sessionsJson } = await inspectSessions(readFileSync(MULTIVIEW));
    expect(labels.rawSessionsJson.length).toBe(sessionsJson.length);
    for (let i = 0; i < sessionsJson.length; i++) {
      expect(labels.rawSessionsJson[i]).toEqual(sessionsJson[i]);
    }
  });

  it("lazy read populates identical rawJson (full fidelity even when model is sparse)", async () => {
    const eager = await readSlp(MULTIVIEW, { openVideos: false });
    const lazy = await readSlpLazy(MULTIVIEW, { openVideos: false });

    expect(lazy.rawSessionsJson).toEqual(eager.rawSessionsJson);

    // frame_group_dicts is fully present under rawJson even though the lazy
    // object model reconstructs instance maps from empty labeledFrames.
    const raw = lazy.sessions[0].rawJson!;
    expect(Array.isArray(raw.frame_group_dicts)).toBe(true);
    expect((raw.frame_group_dicts as unknown[]).length).toBeGreaterThan(0);
  });

  it("streaming read populates identical rawJson (or documents Worker gating)", async () => {
    const eager = await readSlp(MULTIVIEW, { openVideos: false });
    if (!(await streamingWorks())) {
      // Worker path unreachable in this Node runtime (importScripts absent).
      // The eager/lazy assertions above pin the contract the streaming loop
      // (readSessionsStreaming, wired identically) is written to reproduce.
      return;
    }
    const streamed = await readSlpStreaming(
      new Uint8Array(readFileSync(MULTIVIEW)).buffer as ArrayBuffer,
      { openVideos: false, filenameHint: "multiview.slp" },
    );
    expect(streamed.sessions.length).toBe(eager.sessions.length);
    for (let i = 0; i < streamed.sessions.length; i++) {
      expect(streamed.sessions[i].rawJson).toEqual(eager.rawSessionsJson[i]);
    }
  });

  it("streaming session-read wiring is exercised Worker-free (readSessionsStreaming)", async () => {
    // `readSlpStreaming` is Worker-gated and unreachable in Node, so drive the
    // internal session-read loop directly with a fake StreamingH5File. This
    // pins the exact lines LUCID's streaming import (issue #197) depends on.
    const source = {
      calibration: {
        metadata: { rig: "A" },
        "0": { name: "c0", rotation: [0, 0, 0], translation: [0, 0, 0] },
        "1": { name: "c1", rotation: [0, 0, 0], translation: [1, 0, 0] },
      },
      camcorder_to_video_idx_map: { "0": 0, "1": 1 },
      camcorder_to_lf_and_inst_idx_map: { "0": [3, 1] },
      frame_group_dicts: [{ frame_idx: 0, instance_groups: [] }],
      metadata: { lucid: { sessionName: "s", trustTracks: true } },
    };
    const fakeFile = {
      keys: () => ["sessions_json"],
      getDatasetValue: async (name: string) =>
        name === "sessions_json"
          ? { value: [JSON.stringify(source)] }
          : { value: [] },
    } as unknown as Parameters<typeof readSessionsStreaming>[0];

    const sessions = await readSessionsStreaming(
      fakeFile,
      [],
      [],
      [],
      undefined,
    );
    expect(sessions).toHaveLength(1);
    const s = sessions[0];

    // rawJson is the verbatim, full-fidelity parsed dict (incl. the unmodeled
    // camcorder_to_lf_and_inst_idx_map key), matching the eager contract.
    expect(s.rawJson).toEqual(source);
    // Option-1 gap fix mirrored on the streaming path: cameraGroup.metadata.
    expect(s.cameraGroup.metadata).toEqual({ rig: "A" });
    // Deep-cloned snapshot: no shared refs with the object model.
    expect(s.rawJson).not.toBe(source);
    expect(s.metadata).not.toBe(s.rawJson!.metadata);
  });

  it("rawJson is an independent snapshot of the object model (no shared refs)", async () => {
    // Build a session carrying nested metadata at every level, save, and re-read
    // so rawJson is populated from disk — the LUCID round-trip scenario.
    const { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } =
      await import("../src/model/camera.js");
    const { Instance } = await import("../src/model/instance.js");
    const { Skeleton } = await import("../src/model/skeleton.js");
    const { Video } = await import("../src/model/video.js");
    const { Labels } = await import("../src/model/labels.js");
    const { LabeledFrame } = await import("../src/model/labeled-frame.js");

    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const ig = new InstanceGroup({
      instanceByCamera: new Map([[cam, inst]]),
      metadata: { note: { deep: 1 } },
    });
    const fg = new FrameGroup({
      frameIdx: 0,
      instanceGroups: [ig],
      labeledFrameByCamera: new Map([[cam, lf]]),
      metadata: { fgKey: { deep: 2 } },
    });
    const cameraGroup = new CameraGroup({
      cameras: [cam],
      metadata: { rig: "A" },
    });
    const session = new RecordingSession({
      cameraGroup,
      metadata: { lucid: { trustTracks: true } },
    });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      sessions: [session],
    });

    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const reloaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const s = reloaded.sessions[0];
    const raw = s.rawJson as Record<string, unknown>;
    const rawMeta = raw.metadata as { lucid: { trustTracks: unknown } };

    // Distinct object identities between model and the raw snapshot.
    expect(s.metadata).not.toBe(raw.metadata);
    expect((s.metadata as { lucid: unknown }).lucid).not.toBe(rawMeta.lucid);

    // Mutating rawJson does NOT change what the model writes to disk.
    rawMeta.lucid.trustTracks = false;
    expect(
      (s.metadata as { lucid: { trustTracks: unknown } }).lucid.trustTracks,
    ).toBe(true);

    // Mutating the model does NOT change the as-read rawJson snapshot.
    (s.metadata as { lucid: { trustTracks: unknown } }).lucid.trustTracks =
      "edited";
    expect(rawMeta.lucid.trustTracks).toBe(false);
  });

  it("rawJson never leaks into provenance and is not double-written", async () => {
    const labels = await readSlp(MULTIVIEW, { openVideos: false });

    // Baseline write (before touching rawJson).
    const before = await inspectSessions(
      new Uint8Array(await saveSlpToBytes(labels)),
    );

    // Poison rawJson with a marker; leave provenance untouched.
    labels.sessions[0].rawJson = {
      __marker__: true,
      huge: "x".repeat(1000),
    };

    const after = await inspectSessions(
      new Uint8Array(await saveSlpToBytes(labels)),
    );

    // serializeSession ignores rawJson: the marker never reaches sessions_json.
    expect(JSON.stringify(after.sessionsJson)).not.toContain("__marker__");
    // writeMetadata serializes only provenance: no bloat, byte-unchanged.
    expect(after.metadataJson).not.toContain("__marker__");
    expect(after.metadataJson).toBe(before.metadataJson);
    // The rebuilt sessions_json payload is identical before/after.
    expect(after.sessionsJson).toEqual(before.sessionsJson);
  });

  it("rawJson deep-copies on Labels.copy() and getter stays index-aligned", async () => {
    const labels = await readSlp(MULTIVIEW, { openVideos: false });
    const copy = labels.copy();

    // Mutating the original's rawJson must not affect the copy (structuredClone,
    // no aliasing).
    (labels.sessions[0].rawJson as Record<string, unknown>).__mutated__ = true;
    expect(Object.hasOwn(copy.sessions[0].rawJson!, "__mutated__")).toBe(false);

    // In-memory sessions (no rawJson) yield undefined, index-aligned.
    const { RecordingSession } = await import("../src/model/camera.js");
    const { Labels } = await import("../src/model/labels.js");
    const synthetic = new Labels({ sessions: [new RecordingSession()] });
    expect(synthetic.rawSessionsJson).toEqual([undefined]);
    expect(synthetic.rawSessionsJson.length).toBe(synthetic.sessions.length);
  });

  it("Option 3 lossless: stringified-int camera keys survive when cameras are unnamed", async () => {
    const { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } =
      await import("../src/model/camera.js");
    const { Instance } = await import("../src/model/instance.js");
    const { Skeleton } = await import("../src/model/skeleton.js");
    const { Video } = await import("../src/model/video.js");
    const { Labels } = await import("../src/model/labels.js");
    const { LabeledFrame } = await import("../src/model/labeled-frame.js");

    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const v0 = new Video({ filename: "v0.mp4" });
    const v1 = new Video({ filename: "v1.mp4" });
    // Cameras with NO explicit name -> keys should serialize as "0","1".
    const c0 = new Camera({ rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const c1 = new Camera({ rvec: [0, 0, 0], tvec: [1, 0, 0] });
    const i0 = Instance.fromArray([[1, 2]], skeleton);
    const i1 = Instance.fromArray([[3, 4]], skeleton);
    const lf0 = new LabeledFrame({ video: v0, frameIdx: 0, instances: [i0] });
    const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, instances: [i1] });
    const ibc = new Map([
      [c0, i0],
      [c1, i1],
    ]);
    const lfbc = new Map([
      [c0, lf0],
      [c1, lf1],
    ]);
    const fg = new FrameGroup({
      frameIdx: 0,
      instanceGroups: [new InstanceGroup({ instanceByCamera: ibc })],
      labeledFrameByCamera: lfbc,
    });
    const session = new RecordingSession({
      cameraGroup: new CameraGroup({ cameras: [c0, c1] }),
    });
    session.addVideo(v0, c0);
    session.addVideo(v1, c1);
    session.frameGroups.set(0, fg);
    const labels = new Labels({
      labeledFrames: [lf0, lf1],
      videos: [v0, v1],
      skeletons: [skeleton],
      sessions: [session],
    });

    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const { sessionsJson } = await inspectSessions(bytes);
    const s0 = sessionsJson[0];
    const calibKeys = Object.keys(
      s0.calibration as Record<string, unknown>,
    ).filter((k) => k !== "metadata");
    expect(calibKeys.sort()).toEqual(["0", "1"]);
    expect(
      Object.keys(
        s0.camcorder_to_video_idx_map as Record<string, unknown>,
      ).sort(),
    ).toEqual(["0", "1"]);

    // resolveCameraKey semantics: re-read maps decimal keys back to cameras.
    const reloaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    expect(reloaded.sessions[0].videoByCamera.size).toBe(2);
  });

  it("Option 3 known-limitation: unmodeled structural keys dropped on write, recoverable via rawJson", async () => {
    const { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } =
      await import("../src/model/camera.js");
    const { Instance } = await import("../src/model/instance.js");
    const { Skeleton } = await import("../src/model/skeleton.js");
    const { Video } = await import("../src/model/video.js");
    const { Labels } = await import("../src/model/labels.js");
    const { LabeledFrame } = await import("../src/model/labeled-frame.js");

    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const ibc = new Map([[cam, inst]]);
    const lfbc = new Map([[cam, lf]]);
    const fg = new FrameGroup({
      frameIdx: 0,
      instanceGroups: [new InstanceGroup({ instanceByCamera: ibc })],
      labeledFrameByCamera: lfbc,
    });
    const session = new RecordingSession({
      cameraGroup: new CameraGroup({ cameras: [cam] }),
    });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      sessions: [session],
    });

    // Simulate an as-read raw dict carrying an unmodeled top-level structural
    // key that is NOT under a `metadata` sub-dict.
    session.rawJson = {
      calibration: { cam: { name: "cam" } },
      camcorder_to_video_idx_map: { cam: 0 },
      camcorder_to_lf_and_inst_idx_map: { "0": [7, 3] }, // re-derived on write
      frame_group_dicts: [{ frame_idx: 0, instance_groups: [] }],
      unmodeled_top_level_key: { app: "lucid", answer: 42 },
    };

    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const { sessionsJson } = await inspectSessions(bytes);
    const written = sessionsJson[0];

    // KNOWN LIMITATION (documented, not fixed): the fixed-shape serializer drops
    // unmodeled top-level keys and re-derives camcorder_to_lf_and_inst_idx_map.
    expect(Object.hasOwn(written, "unmodeled_top_level_key")).toBe(false);
    // The write emits its own top-level shape (no verbatim echo of the source).
    expect(Object.keys(written).sort()).toEqual([
      "calibration",
      "camcorder_to_video_idx_map",
      "frame_group_dicts",
      "metadata",
    ]);

    // FIDELITY GUARANTEE is Option 2 (rawJson), not the object-model write:
    // the ORIGINAL dict is still fully recoverable in-memory.
    expect(session.rawJson.unmodeled_top_level_key).toEqual({
      app: "lucid",
      answer: 42,
    });
    expect(session.rawJson.camcorder_to_lf_and_inst_idx_map).toEqual({
      "0": [7, 3],
    });
  });
});
