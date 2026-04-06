/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readSlp } from "../src/codecs/slp/read.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("Streaming Sessions", () => {
  it("non-streaming reader loads sessions from multiview.slp", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    expect(labels.sessions.length).toBeGreaterThan(0);
    const session = labels.sessions[0];
    expect(session.cameraGroup.cameras.length).toBeGreaterThan(0);
  });

  it("sessions round-trip through write and read", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    if (labels.sessions.length === 0) return;

    const { saveSlpToBytes } = await import("../src/codecs/slp/write.js");
    const bytes = await saveSlpToBytes(labels);
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.sessions.length).toBe(labels.sessions.length);
    expect(reloaded.sessions[0].cameraGroup.cameras.length).toBe(labels.sessions[0].cameraGroup.cameras.length);
  });

  it("round-trips camera size field through session write/read", async () => {
    const { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } = await import("../src/model/camera.js");
    const { Instance } = await import("../src/model/instance.js");
    const { Skeleton } = await import("../src/model/skeleton.js");
    const { Video } = await import("../src/model/video.js");
    const { Labels } = await import("../src/model/labels.js");
    const { LabeledFrame } = await import("../src/model/labeled-frame.js");
    const { saveSlpToBytes } = await import("../src/codecs/slp/write.js");

    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "v.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0], size: [1920, 1080] });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const instanceByCamera = new Map();
    instanceByCamera.set(cam, inst);
    const lfByCamera = new Map();
    lfByCamera.set(cam, lf);
    const fg = new FrameGroup({ frameIdx: 0, instanceGroups: [new InstanceGroup({ instanceByCamera })], labeledFrameByCamera: lfByCamera });
    const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [cam] }) });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({ labeledFrames: [lf], videos: [video], skeletons: [skeleton], sessions: [session] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.sessions[0].cameraGroup.cameras[0].size).toEqual([1920, 1080]);
  });

  it("writes and reads camcorder_to_lf_and_inst_idx_map in session data", async () => {
    const { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } = await import("../src/model/camera.js");
    const { Instance } = await import("../src/model/instance.js");
    const { Skeleton } = await import("../src/model/skeleton.js");
    const { Video } = await import("../src/model/video.js");
    const { Labels } = await import("../src/model/labels.js");
    const { LabeledFrame } = await import("../src/model/labeled-frame.js");
    const { saveSlpToBytes } = await import("../src/codecs/slp/write.js");

    const skeleton = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });
    const video1 = new Video({ filename: "cam1.mp4" });
    const video2 = new Video({ filename: "cam2.mp4" });
    const cam1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const cam2 = new Camera({ name: "cam2", rvec: [0.1, 0, 0], tvec: [100, 0, 0] });
    const inst1 = Instance.fromArray([[10, 20], [30, 40]], skeleton);
    const inst2 = Instance.fromArray([[50, 60], [70, 80]], skeleton);
    const lf1 = new LabeledFrame({ video: video1, frameIdx: 0, instances: [inst1] });
    const lf2 = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst2] });

    const instanceByCamera = new Map();
    instanceByCamera.set(cam1, inst1);
    instanceByCamera.set(cam2, inst2);
    const lfByCamera = new Map();
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
});
