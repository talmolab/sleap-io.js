/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Video } from "../../src/model/video.js";

describe("Video", () => {
  describe("shape getter/setter", () => {
    it("returns null when no shape is available", () => {
      const video = new Video({ filename: "test.mp4" });
      expect(video.shape).toBeNull();
    });

    it("falls through to backendMetadata.shape", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { shape: [100, 480, 640, 3] },
      });
      expect(video.shape).toEqual([100, 480, 640, 3]);
    });

    it("setter overrides backend and backendMetadata", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { shape: [100, 480, 640, 3] },
      });
      video.shape = [200, 720, 1280, 3];
      expect(video.shape).toEqual([200, 720, 1280, 3]);
    });

    it("setter can be cleared back to null", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { shape: [100, 480, 640, 3] },
      });
      video.shape = [200, 720, 1280, 3];
      video.shape = null;
      // Falls back to backendMetadata
      expect(video.shape).toEqual([100, 480, 640, 3]);
    });
  });

  describe("fps getter/setter", () => {
    it("returns null when no fps is available", () => {
      const video = new Video({ filename: "test.mp4" });
      expect(video.fps).toBeNull();
    });

    it("falls through to backendMetadata.fps", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { fps: 30 },
      });
      expect(video.fps).toBe(30);
    });

    it("setter overrides backend and backendMetadata", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { fps: 30 },
      });
      video.fps = 60;
      expect(video.fps).toBe(60);
    });

    it("setter can be cleared back to null", () => {
      const video = new Video({
        filename: "test.mp4",
        backendMetadata: { fps: 30 },
      });
      video.fps = 60;
      video.fps = null;
      expect(video.fps).toBe(30);
    });
  });
});
