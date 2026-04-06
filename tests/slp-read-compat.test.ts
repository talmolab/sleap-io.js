/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../src/model/camera.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("Backward compatibility", () => {
  it("loads multiview.slp fixture (no identities) without errors", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    expect(labels.identities).toEqual([]);
    if (labels.sessions.length > 0) {
      for (const fg of labels.sessions[0].frameGroups.values()) {
        for (const ig of fg.instanceGroups) {
          expect(ig.identity).toBeUndefined();
        }
      }
    }
  });

  it("loads typical.slp fixture (no sessions) without errors", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "typical.slp"), { openVideos: false });
    expect(labels.identities).toEqual([]);
    expect(labels.sessions).toEqual([]);
  });

  it("round-trips a session without identities (no identities_json dataset)", async () => {
    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "test.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const inst = Instance.fromArray([[10, 20]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const instanceByCamera = new Map<Camera, Instance>();
    instanceByCamera.set(cam, inst);
    const group = new InstanceGroup({ instanceByCamera });
    const lfByCamera = new Map<Camera, LabeledFrame>();
    lfByCamera.set(cam, lf);
    const fg = new FrameGroup({ frameIdx: 0, instanceGroups: [group], labeledFrameByCamera: lfByCamera });
    const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [cam] }) });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({ labeledFrames: [lf], videos: [video], skeletons: [skeleton], sessions: [session] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toEqual([]);
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0].identity).toBeUndefined();
  });
});

describe("Python format compatibility", () => {
  it("reads session with camcorder_to_lf_and_inst_idx_map alongside JS fields", async () => {
    // Write normally — the writer now emits both JS fields and camcorder_to_lf_and_inst_idx_map
    const skeleton = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });
    const video1 = new Video({ filename: "cam1.mp4" });
    const video2 = new Video({ filename: "cam2.mp4" });
    const inst1 = Instance.fromArray([[10, 20], [30, 40]], skeleton);
    const inst2 = Instance.fromArray([[50, 60], [70, 80]], skeleton);
    const lf1 = new LabeledFrame({ video: video1, frameIdx: 0, instances: [inst1] });
    const lf2 = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst2] });

    const cam1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const cam2 = new Camera({ name: "cam2", rvec: [0.1, 0, 0], tvec: [100, 0, 0] });
    const instanceByCamera = new Map<Camera, Instance>();
    instanceByCamera.set(cam1, inst1);
    instanceByCamera.set(cam2, inst2);
    const lfByCamera = new Map<Camera, LabeledFrame>();
    lfByCamera.set(cam1, lf1);
    lfByCamera.set(cam2, lf2);
    const fg = new FrameGroup({ frameIdx: 0, instanceGroups: [new InstanceGroup({ instanceByCamera })], labeledFrameByCamera: lfByCamera });
    const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [cam1, cam2] }) });
    session.addVideo(video1, cam1);
    session.addVideo(video2, cam2);
    session.frameGroups.set(0, fg);
    const labels = new Labels({ labeledFrames: [lf1, lf2], videos: [video1, video2], skeletons: [skeleton], sessions: [session] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.sessions).toHaveLength(1);
    const loadedFg = loaded.sessions[0].frameGroups.get(0)!;
    expect(loadedFg.instanceGroups[0].instanceByCamera.size).toBe(2);
    expect(loadedFg.labeledFrameByCamera.size).toBe(2);
  });

  it("reads Python-only format (camcorder_to_lf_and_inst_idx_map without instances field)", async () => {
    // Create a minimal SLP, patch session JSON to remove JS fields, verify reader handles it
    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const inst = Instance.fromArray([[10, 20]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const instanceByCamera = new Map<Camera, Instance>();
    instanceByCamera.set(cam, inst);
    const lfByCamera = new Map<Camera, LabeledFrame>();
    lfByCamera.set(cam, lf);
    const fg = new FrameGroup({ frameIdx: 0, instanceGroups: [new InstanceGroup({ instanceByCamera })], labeledFrameByCamera: lfByCamera });
    const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [cam] }) });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({ labeledFrames: [lf], videos: [video], skeletons: [skeleton], sessions: [session] });

    const bytes = await saveSlpToBytes(labels);

    // Read the session JSON and strip JS-specific fields
    const { openH5File, getH5Module, getH5FileSystem } = await import("../src/codecs/slp/h5.js");
    const { file: origFile, close: closeOrig } = await openH5File(new Uint8Array(bytes).buffer);
    const sessDs = origFile.get("sessions_json") as any;
    const sessionJson = JSON.parse(typeof sessDs.value[0] === "string" ? sessDs.value[0] : new TextDecoder().decode(sessDs.value[0]));

    // Verify the map exists before stripping
    const ig = sessionJson.frame_group_dicts[0].instance_groups[0];
    expect(ig.camcorder_to_lf_and_inst_idx_map).toBeDefined();

    // Remove JS-only fields to simulate Python format
    delete ig.instances;
    delete sessionJson.frame_group_dicts[0].labeled_frame_by_camera;
    closeOrig();

    // Build a new SLP file with the patched session JSON
    const module = await getH5Module();
    const tmpPath = `/tmp/test_py_compat_${Date.now()}.slp`;
    const newFile = new module.File(tmpPath, "w");
    const { file: srcFile, close: closeSrc } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      // Copy metadata
      const metaGroup = srcFile.get("metadata") as any;
      newFile.create_group("metadata");
      const newMeta = newFile.get("metadata");
      const fmtId = metaGroup.attrs?.format_id?.value ?? metaGroup.attrs?.format_id ?? 1.4;
      newMeta.create_attribute("format_id", Number(fmtId));
      const jsonVal = metaGroup.attrs?.json?.value ?? metaGroup.attrs?.json;
      const jsonStr = typeof jsonVal === "string" ? jsonVal : new TextDecoder().decode(jsonVal instanceof Uint8Array ? jsonVal : new Uint8Array(jsonVal.buffer));
      const enc = new TextEncoder();
      newMeta.create_attribute("json", jsonStr, null, `S${enc.encode(jsonStr).length}`);

      // Copy essential datasets
      for (const name of ["videos_json", "tracks_json", "suggestions_json"]) {
        const src = srcFile.get(name) as any;
        if (src?.value) newFile.create_dataset({ name, data: src.value });
      }
      for (const name of ["frames", "instances", "points", "pred_points"]) {
        const src = srcFile.get(name) as any;
        if (src?.value != null) {
          newFile.create_dataset({ name, data: src.value, shape: src.shape, dtype: src.dtype });
          const fn = src.attrs?.field_names;
          if (fn) {
            const fnStr = typeof (fn.value ?? fn) === "string" ? (fn.value ?? fn) : new TextDecoder().decode((fn.value ?? fn) instanceof Uint8Array ? (fn.value ?? fn) : new Uint8Array((fn.value ?? fn).buffer));
            newFile.get(name).create_attribute("field_names", fnStr, null, `S${enc.encode(fnStr).length}`);
          }
        }
      }

      // Write patched session JSON
      newFile.create_dataset({ name: "sessions_json", data: [JSON.stringify(sessionJson)] });
    } finally {
      closeSrc();
    }
    newFile.close();

    const fs = getH5FileSystem(module);
    const patchedBytes = fs.readFile!(tmpPath);
    fs.unlink!(tmpPath);

    const loaded = await readSlp(new Uint8Array(patchedBytes).buffer, { openVideos: false });
    expect(loaded.sessions).toHaveLength(1);
    const loadedFg = loaded.sessions[0].frameGroups.get(0)!;
    // Reconstructed from camcorder_to_lf_and_inst_idx_map
    expect(loadedFg.instanceGroups[0].instanceByCamera.size).toBe(1);
    expect(loadedFg.labeledFrameByCamera.size).toBe(1);
  });
});
