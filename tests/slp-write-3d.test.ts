/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../src/model/camera.js";
import { Identity } from "../src/model/identity.js";
import { Instance3D, PredictedInstance3D } from "../src/model/instance3d.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";

function makeTestLabels(options?: { withIdentity?: boolean; withInstance3d?: boolean; withPredicted3d?: boolean }): Labels {
  const skeleton = new Skeleton({ nodes: ["nose", "tail"], edges: [["nose", "tail"]] });
  const video1 = new Video({ filename: "cam1.mp4" });
  const video2 = new Video({ filename: "cam2.mp4" });
  const cam1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
  const cam2 = new Camera({ name: "cam2", rvec: [0.1, 0, 0], tvec: [100, 0, 0] });

  const inst1 = Instance.fromArray([[100, 200], [300, 400]], skeleton);
  const inst2 = Instance.fromArray([[150, 250], [350, 450]], skeleton);

  const lf1 = new LabeledFrame({ video: video1, frameIdx: 0, instances: [inst1] });
  const lf2 = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst2] });

  const identity = options?.withIdentity ? new Identity({ name: "mouse_A", color: "#ff0000" }) : undefined;
  const identities = identity ? [identity] : [];

  let instance3d: Instance3D | undefined;
  if (options?.withPredicted3d) {
    instance3d = new PredictedInstance3D({
      points: [[50, 100, 200], [150, 300, 400]],
      skeleton,
      score: 0.92,
      pointScores: [0.95, 0.88],
    });
  } else if (options?.withInstance3d) {
    instance3d = new Instance3D({
      points: [[50, 100, 200], [150, 300, 400]],
      skeleton,
      score: 0.92,
    });
  }

  const instanceByCamera = new Map<Camera, Instance>();
  instanceByCamera.set(cam1, inst1);
  instanceByCamera.set(cam2, inst2);
  const group = new InstanceGroup({ instanceByCamera, identity, instance3d });

  const labeledFrameByCamera = new Map<Camera, LabeledFrame>();
  labeledFrameByCamera.set(cam1, lf1);
  labeledFrameByCamera.set(cam2, lf2);
  const frameGroup = new FrameGroup({ frameIdx: 0, instanceGroups: [group], labeledFrameByCamera });

  const cameraGroup = new CameraGroup({ cameras: [cam1, cam2] });
  const session = new RecordingSession({ cameraGroup });
  session.addVideo(video1, cam1);
  session.addVideo(video2, cam2);
  session.frameGroups.set(0, frameGroup);

  return new Labels({
    labeledFrames: [lf1, lf2],
    videos: [video1, video2],
    skeletons: [skeleton],
    sessions: [session],
    identities,
  });
}

describe("SLP write with identity and 3D data", () => {
  it("round-trips identity through write and read", async () => {
    const labels = makeTestLabels({ withIdentity: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toHaveLength(1);
    expect(loaded.identities[0].name).toBe("mouse_A");
    expect(loaded.identities[0].color).toBe("#ff0000");

    expect(loaded.sessions).toHaveLength(1);
    const session = loaded.sessions[0];
    const frameGroup = session.frameGroups.get(0);
    expect(frameGroup).toBeDefined();
    expect(frameGroup!.instanceGroups).toHaveLength(1);
    expect(frameGroup!.instanceGroups[0].identity).toBe(loaded.identities[0]);
  });

  it("round-trips Instance3D through write and read", async () => {
    const labels = makeTestLabels({ withInstance3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    const session = loaded.sessions[0];
    const frameGroup = session.frameGroups.get(0)!;
    const group = frameGroup.instanceGroups[0];
    expect(group.instance3d).toBeDefined();
    expect(group.instance3d).toBeInstanceOf(Instance3D);
    expect(group.instance3d!.points).toEqual([[50, 100, 200], [150, 300, 400]]);
    expect(group.instance3d!.score).toBe(0.92);
  });

  it("round-trips PredictedInstance3D through write and read", async () => {
    const labels = makeTestLabels({ withPredicted3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    const group = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(group.instance3d).toBeInstanceOf(PredictedInstance3D);
    const pred = group.instance3d as PredictedInstance3D;
    expect(pred.score).toBe(0.92);
    expect(pred.pointScores).toEqual([0.95, 0.88]);
  });

  it("sets format version to 1.9 when identities are present", async () => {
    const labels = makeTestLabels({ withIdentity: true });
    const bytes = await saveSlpToBytes(labels);
    // Read back and check format_id in metadata
    const { openH5File } = await import("../src/codecs/slp/h5.js");
    const { file, close } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      const metadataGroup = file.get("metadata");
      const attrs = (metadataGroup as any).attrs ?? {};
      const formatId = Number(attrs["format_id"]?.value ?? attrs["format_id"]);
      expect(formatId).toBeCloseTo(1.9);
    } finally {
      close();
    }
  });

  it("writes no identities_json dataset when no identities", async () => {
    const labels = makeTestLabels();
    const bytes = await saveSlpToBytes(labels);
    const { openH5File } = await import("../src/codecs/slp/h5.js");
    const { file, close } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      const ds = file.get("identities_json");
      expect(ds).toBeNull();
    } finally {
      close();
    }
  });

  it("round-trips identity + instance3d together", async () => {
    const labels = makeTestLabels({ withIdentity: true, withInstance3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toHaveLength(1);
    const group = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(group.identity).toBe(loaded.identities[0]);
    expect(group.instance3d).toBeDefined();
    expect(group.instance3d!.points).toEqual([[50, 100, 200], [150, 300, 400]]);
  });

  it("writes camcorder_to_lf_and_inst_idx_map with numeric keys", async () => {
    const labels = makeTestLabels();
    const bytes = await saveSlpToBytes(labels);
    const { openH5File } = await import("../src/codecs/slp/h5.js");
    const { file, close } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      const ds = file.get("sessions_json") as any;
      const sessionJson = JSON.parse(typeof ds.value[0] === "string" ? ds.value[0] : new TextDecoder().decode(ds.value[0]));
      const fg = sessionJson.frame_group_dicts[0];
      const ig = fg.instance_groups[0];

      // camcorder_to_lf_and_inst_idx_map should exist with numeric keys
      expect(ig.camcorder_to_lf_and_inst_idx_map).toBeDefined();
      const mapKeys = Object.keys(ig.camcorder_to_lf_and_inst_idx_map);
      expect(mapKeys.every((k: string) => !isNaN(Number(k)))).toBe(true);

      // Each value should be [lfIdx, instIdx]
      for (const val of Object.values(ig.camcorder_to_lf_and_inst_idx_map)) {
        expect(Array.isArray(val)).toBe(true);
        expect((val as number[]).length).toBe(2);
      }

      // instances keys should also be numeric
      const instKeys = Object.keys(ig.instances);
      expect(instKeys.every((k: string) => !isNaN(Number(k)))).toBe(true);
    } finally {
      close();
    }
  });

  it("identity metadata does not clobber name/color", async () => {
    const id = new Identity({ name: "real_name", color: "#ff0000", metadata: { name: "shadow", color: "#00ff00", extra: 42 } });
    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      identities: [id],
    });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities[0].name).toBe("real_name");
    expect(loaded.identities[0].color).toBe("#ff0000");
    expect(loaded.identities[0].metadata.extra).toBe(42);
    expect(loaded.identities[0].metadata).not.toHaveProperty("name");
    expect(loaded.identities[0].metadata).not.toHaveProperty("color");
  });

  it("round-trips camera size field", async () => {
    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0], size: [640, 480] });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
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
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.sessions[0].cameraGroup.cameras[0].size).toEqual([640, 480]);
  });
});
