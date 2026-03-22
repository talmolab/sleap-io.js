/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";

describe("Labels.addVideo()", () => {
  it("adds a video to the labels", () => {
    const labels = new Labels();
    const video = new Video({ filename: "video.mp4" });
    labels.addVideo(video);
    expect(labels.videos).toHaveLength(1);
    expect(labels.videos[0]).toBe(video);
  });

  it("does not add duplicate videos", () => {
    const labels = new Labels();
    const video = new Video({ filename: "video.mp4" });
    labels.addVideo(video);
    labels.addVideo(video);
    expect(labels.videos).toHaveLength(1);
  });

  it("adds multiple distinct videos", () => {
    const labels = new Labels();
    const v1 = new Video({ filename: "a.mp4" });
    const v2 = new Video({ filename: "b.mp4" });
    labels.addVideo(v1);
    labels.addVideo(v2);
    expect(labels.videos).toHaveLength(2);
  });

  it("works alongside append()", () => {
    const labels = new Labels();
    const video = new Video({ filename: "video.mp4" });
    labels.addVideo(video);

    const frame = new LabeledFrame({ video, frameIdx: 0 });
    labels.append(frame);

    // Video should still appear only once
    expect(labels.videos).toHaveLength(1);
    expect(labels.videos[0]).toBe(video);
  });
});
