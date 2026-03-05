/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";

describe("Labels.find()", () => {
  it("uses reference equality for video matching", () => {
    const video1 = new Video({ filename: "video.mp4" });
    const video2 = new Video({ filename: "video.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });

    const frame1 = new LabeledFrame({ video: video1, frameIdx: 0 });
    const frame2 = new LabeledFrame({ video: video2, frameIdx: 0 });

    const labels = new Labels({
      labeledFrames: [frame1, frame2],
      videos: [video1, video2],
      skeletons: [skeleton],
    });

    // Should only match frame1 via reference equality, not frame2
    const results = labels.find({ video: video1 });
    expect(results).toEqual([frame1]);
    expect(results).not.toContain(frame2);
  });

  it("does not match videos with same basename in .pkg.slp scenario", () => {
    // In .pkg.slp files, multiple embedded videos share the same container filename
    const video1 = new Video({ filename: "project.pkg.slp" });
    const video2 = new Video({ filename: "project.pkg.slp" });
    const video3 = new Video({ filename: "project.pkg.slp" });

    const frame1 = new LabeledFrame({ video: video1, frameIdx: 0 });
    const frame2 = new LabeledFrame({ video: video2, frameIdx: 0 });
    const frame3 = new LabeledFrame({ video: video3, frameIdx: 0 });

    const labels = new Labels({
      labeledFrames: [frame1, frame2, frame3],
      videos: [video1, video2, video3],
    });

    // Should only return the frame for video1, not all three
    const results = labels.find({ video: video1 });
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(frame1);
  });

  it("filters by frameIdx", () => {
    const video = new Video({ filename: "video.mp4" });

    const frame0 = new LabeledFrame({ video, frameIdx: 0 });
    const frame5 = new LabeledFrame({ video, frameIdx: 5 });
    const frame10 = new LabeledFrame({ video, frameIdx: 10 });

    const labels = new Labels({
      labeledFrames: [frame0, frame5, frame10],
    });

    expect(labels.find({ video, frameIdx: 5 })).toEqual([frame5]);
    expect(labels.find({ frameIdx: 10 })).toEqual([frame10]);
  });
});

describe("Video.matchesPath()", () => {
  it("matches identical paths in strict mode", () => {
    const v1 = new Video({ filename: "/home/user/video.mp4" });
    const v2 = new Video({ filename: "/home/user/video.mp4" });
    expect(v1.matchesPath(v2, true)).toBe(true);
  });

  it("does not match different paths in strict mode", () => {
    const v1 = new Video({ filename: "/home/user/video.mp4" });
    const v2 = new Video({ filename: "/other/path/video.mp4" });
    expect(v1.matchesPath(v2, true)).toBe(false);
  });

  it("matches by basename in non-strict mode with forward slashes", () => {
    const v1 = new Video({ filename: "/home/user/video.mp4" });
    const v2 = new Video({ filename: "/other/path/video.mp4" });
    expect(v1.matchesPath(v2, false)).toBe(true);
  });

  it("matches by basename in non-strict mode with backslashes (Windows paths)", () => {
    const v1 = new Video({ filename: "C:\\Users\\user\\video.mp4" });
    const v2 = new Video({ filename: "D:\\other\\path\\video.mp4" });
    expect(v1.matchesPath(v2, false)).toBe(true);
  });

  it("matches by basename with mixed separators", () => {
    const v1 = new Video({ filename: "/home/user/video.mp4" });
    const v2 = new Video({ filename: "C:\\Users\\user\\video.mp4" });
    expect(v1.matchesPath(v2, false)).toBe(true);
  });

  it("does not match different basenames in non-strict mode", () => {
    const v1 = new Video({ filename: "/home/user/video1.mp4" });
    const v2 = new Video({ filename: "/home/user/video2.mp4" });
    expect(v1.matchesPath(v2, false)).toBe(false);
  });

  it("compares array filenames by value", () => {
    const v1 = new Video({ filename: ["frame001.png", "frame002.png"] });
    const v2 = new Video({ filename: ["frame001.png", "frame002.png"] });
    const v3 = new Video({ filename: ["frame003.png", "frame004.png"] });
    expect(v1.matchesPath(v2)).toBe(true);
    expect(v1.matchesPath(v3)).toBe(false);
  });
});
