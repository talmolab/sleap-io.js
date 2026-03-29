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
