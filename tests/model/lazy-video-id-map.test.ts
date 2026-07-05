/**
 * Lazy readers must apply the same raw-`frames.video`-id -> `videos`-index remap
 * the eager readers use (issue #204). Before the fix, `LazyDataStore` indexed
 * `videos[rawId]` directly, so a file with non-contiguous group ids
 * (`video0`, `video2`) attached frames to the wrong video or dropped them
 * (`videos[2] === undefined`). These tests pin the remap in `materializeFrame`,
 * `toNumpy`, and the shared `buildVideoIdMap`.
 */
import { describe, it, expect } from "../bun-test";
import { LazyDataStore } from "../../src/model/lazy.js";
import { buildVideoIdMap } from "../../src/model/video-id-map.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";

function video(dataset: string): Video {
  return new Video({ filename: ".", backendMetadata: { dataset } });
}

/**
 * A 2-frame store: frame 0 -> raw video id `ids[0]`, frame 1 -> raw video id
 * `ids[1]`; one 1-point user instance per frame.
 */
function makeStore(videos: Video[], ids: [number, number]): LazyDataStore {
  return new LazyDataStore({
    framesData: {
      frame_id: [0, 1],
      video: ids,
      frame_idx: [5, 7],
      instance_id_start: [0, 1],
      instance_id_end: [1, 2],
    },
    instancesData: {
      instance_type: [0, 0],
      skeleton: [0, 0],
      track: [-1, -1],
      point_id_start: [0, 1],
      point_id_end: [1, 2],
      score: [0, 0],
      tracking_score: [0, 0],
      from_predicted: [-1, -1],
    },
    pointsData: {
      x: [10, 30],
      y: [20, 40],
      visible: [1, 1],
      complete: [1, 1],
      score: [0, 0],
    },
    predPointsData: { x: [], y: [], visible: [], complete: [], score: [] },
    skeletons: [new Skeleton({ nodes: ["A"] })],
    tracks: [],
    videos,
    formatId: 1.2,
  });
}

describe("buildVideoIdMap", () => {
  it("returns an identity map for contiguous 0-based ids", () => {
    const videos = [video("video0/video"), video("video1/video")];
    const map = buildVideoIdMap({ video: [0, 1, 0, 1] }, videos);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(1);
  });

  it("maps non-contiguous group ids to array indices", () => {
    const videos = [video("video0/video"), video("video2/video")];
    const map = buildVideoIdMap({ video: [0, 2] }, videos);
    expect(map.get(0)).toBe(0);
    expect(map.get(2)).toBe(1); // raw id 2 -> array index 1
  });

  it("returns an empty map when there are no frames", () => {
    expect(buildVideoIdMap({ video: [] }, [video("video0/video")]).size).toBe(
      0,
    );
  });
});

describe("LazyDataStore.materializeFrame — video id remap (#204)", () => {
  it("attaches frames to the correct video for non-contiguous ids", () => {
    const videos = [video("video0/video"), video("video2/video")];
    const store = makeStore(videos, [0, 2]);

    const f0 = store.materializeFrame(0);
    const f1 = store.materializeFrame(1);

    expect(f0).not.toBeNull();
    expect(f0!.video).toBe(videos[0]);
    expect(f0!.frameIdx).toBe(5);

    // Before the fix this was `videos[2]` (undefined) -> frame dropped (null).
    expect(f1).not.toBeNull();
    expect(f1!.video).toBe(videos[1]);
    expect(f1!.frameIdx).toBe(7);
    expect(f1!.instances.length).toBe(1);
  });

  it("still resolves the contiguous (identity) case", () => {
    const videos = [video("video0/video"), video("video1/video")];
    const store = makeStore(videos, [0, 1]);
    expect(store.materializeFrame(0)!.video).toBe(videos[0]);
    expect(store.materializeFrame(1)!.video).toBe(videos[1]);
  });
});

describe("LazyDataStore.toNumpy — video id remap (#204)", () => {
  it("selects the requested video's frames under non-contiguous ids", () => {
    const videos = [video("video0/video"), video("video2/video")];
    const store = makeStore(videos, [0, 2]);

    // videos[1] owns only frame 1 (frame_idx 7, point (30,40)).
    const arr = store.toNumpy({ video: videos[1] });
    // Frame dimension spans 0..maxFrameIdx (7) -> length 8; row 7 is populated.
    expect(arr.length).toBe(8);
    expect(arr[7][0][0]).toEqual([30, 40]);
    // A frame this video does NOT own (index 5, which belongs to videos[0]) is NaN.
    expect(Number.isNaN(arr[5][0][0][0])).toBe(true);

    // videos[0] owns only frame 0 (frame_idx 5, point (10,20)).
    const arr0 = store.toNumpy({ video: videos[0] });
    expect(arr0[5][0][0]).toEqual([10, 20]);
  });
});
