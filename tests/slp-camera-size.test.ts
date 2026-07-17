/**
 * Camera calibration `size` interop (follow-up).
 *
 * Python `make_camera` does a bare `camera_dict.pop("size")`, so a JS-written
 * calibration that OMITTED `size` (older behavior) KeyErrored on the Python reader.
 * The writer now always emits `size` — `""` when unknown (matching Python's
 * `camera_to_dict`) — and the reader normalizes `""`/`[]`/missing back to
 * `undefined`.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import {
  Camera,
  CameraGroup,
  InstanceGroup,
  FrameGroup,
  RecordingSession,
} from "../src/model/camera.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";

const SK = new Skeleton({ nodes: ["A", "B"], edges: [] });

function sessionLabels(): Labels {
  const v1 = new Video({ filename: "c1.mp4" });
  const v2 = new Video({ filename: "c2.mp4" });
  // cam1 has NO size; cam2 has a size.
  const c1 = new Camera({ name: "c1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
  const c2 = new Camera({
    name: "c2",
    rvec: [0, 0, 0],
    tvec: [1, 0, 0],
    size: [1280, 960],
  });
  const i1 = Instance.fromArray(
    [
      [1, 2],
      [3, 4],
    ],
    SK,
  );
  const i2 = Instance.fromArray(
    [
      [5, 6],
      [7, 8],
    ],
    SK,
  );
  const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, instances: [i1] });
  const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, instances: [i2] });
  const ig = new InstanceGroup({
    instanceByCamera: new Map([
      [c1, i1],
      [c2, i2],
    ]),
  });
  const fg = new FrameGroup({
    frameIdx: 0,
    instanceGroups: [ig],
    labeledFrameByCamera: new Map([
      [c1, lf1],
      [c2, lf2],
    ]),
  });
  const s = new RecordingSession({
    cameraGroup: new CameraGroup({ cameras: [c1, c2] }),
  });
  s.addVideo(v1, c1);
  s.addVideo(v2, c2);
  s.frameGroups.set(0, fg);
  return new Labels({
    labeledFrames: [lf1, lf2],
    videos: [v1, v2],
    skeletons: [SK],
    sessions: [s],
  });
}

describe("Camera calibration size interop", () => {
  it("round-trips a size-less and a sized camera", async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(sessionLabels()));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const cams = loaded.sessions[0].cameraGroup.cameras;
    expect(cams).toHaveLength(2);
    expect(cams[0].size).toBeUndefined(); // "" -> undefined (not "" or [])
    expect(cams[1].size).toEqual([1280, 960]);
  });

  it('always writes a `size` key ("" when unknown) so Python can pop it', async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(sessionLabels()));
    const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
    try {
      const ds = file.get("sessions_json") as any;
      const raw = ds.value[0];
      const json = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw),
      );
      const calib = json.calibration as Record<string, any>;
      // Both cameras carry a `size` key; cam_0 is "" (unknown), cam_1 is [w,h].
      expect("size" in calib.cam_0).toBe(true);
      expect(calib.cam_0.size).toBe("");
      expect(calib.cam_1.size).toEqual([1280, 960]);
    } finally {
      close();
    }
  });
});
