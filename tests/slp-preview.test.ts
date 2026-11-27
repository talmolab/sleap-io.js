import { describe, it, expect } from "./bun-test";
import {
  Labels,
  LabeledFrame,
  Instance,
  PredictedInstance,
  Skeleton,
  Video,
  PreviewFrame,
  DEFAULT_PREVIEW_MAX_SIZE,
  encodePreviewJpeg,
  createPreviewFrameFromPixels,
  saveSlpToBytes,
  loadSlp,
} from "../src/index.js";
import { loadSlpMetadata, loadSlpPreview } from "../src/lite.js";
import type { VideoBackend } from "../src/video/backend.js";

function makeSyntheticRgb(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      buf[i] = (x * 255) / Math.max(1, width - 1);
      buf[i + 1] = (y * 255) / Math.max(1, height - 1);
      buf[i + 2] = 96;
    }
  }
  return buf;
}

function makeMockBackend(
  width: number,
  height: number,
  channels: number = 3,
): VideoBackend {
  const frames = 20;
  return {
    filename: "mock_video.mp4",
    shape: [frames, height, width, channels],
    async getFrame(frameIndex: number) {
      if (frameIndex < 0 || frameIndex >= frames) return null;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          rgba[i] = (x + frameIndex * 10) & 255;
          rgba[i + 1] = channels === 1 ? rgba[i] : (y + frameIndex * 5) & 255;
          rgba[i + 2] = channels === 1 ? rgba[i] : 120;
          rgba[i + 3] = 255;
        }
      }
      return { data: rgba, width, height } as ImageData;
    },
    close() {},
  };
}

describe("SLP /preview group", () => {
  it("downscales large RGB images to maxSize preserving aspect ratio and never upscales", () => {
    const rgb = makeSyntheticRgb(1600, 800);
    const enc = encodePreviewJpeg(rgb, 1600, 800, 3);
    expect(enc.width).toBe(DEFAULT_PREVIEW_MAX_SIZE);
    expect(enc.height).toBe(DEFAULT_PREVIEW_MAX_SIZE / 2);
    // JPEG SOI / EOI markers
    expect(enc.data[0]).toBe(0xff);
    expect(enc.data[1]).toBe(0xd8);
    expect(enc.data[enc.data.length - 2]).toBe(0xff);
    expect(enc.data[enc.data.length - 1]).toBe(0xd9);

    // Small grayscale image keeps native dimensions and encodes as 1-component JPEG.
    const small = new Uint8Array(120 * 80 * 3);
    for (let p = 0; p < 120 * 80; p++) {
      const v = p & 255;
      small[p * 3] = v;
      small[p * 3 + 1] = v;
      small[p * 3 + 2] = v;
    }
    const encSmall = encodePreviewJpeg(small, 120, 80, 3);
    expect(encSmall.width).toBe(120);
    expect(encSmall.height).toBe(80);
    expect(encSmall.data[0]).toBe(0xff);
    expect(encSmall.data[1]).toBe(0xd8);
  });

  it.each([
    "v2",
    "v3",
  ] as const)("round-trips /preview in %s layout across eager, lazy, and lite readers", async (slpVersion) => {
    const skel = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "fake.mp4", openBackend: false });
    const inst = Instance.fromArray(
      [
        [10, 20],
        [30, 40],
      ],
      skel,
    );
    const lf = new LabeledFrame({ video, frameIdx: 7, instances: [inst] });
    const pf = createPreviewFrameFromPixels(
      video,
      7,
      makeSyntheticRgb(320, 240),
      320,
      240,
      3,
    );
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skel],
      previewFrames: [pf],
    });

    const bytes = await saveSlpToBytes(labels, { slpVersion });

    // Lite / jsfive reader sees hasPreview=true, zero unreadTables, and extracts bytes.
    const meta = await loadSlpMetadata(bytes);
    expect(meta.hasPreview).toBe(true);
    if (slpVersion === "v3") {
      expect(meta.formatId).toBeGreaterThanOrEqual(3.0);
      expect(meta.format3?.unreadTables).toEqual([]);
    } else {
      expect(meta.formatId).toBeLessThan(3.0);
    }
    const litePreviews = await loadSlpPreview(bytes);
    expect(litePreviews).toHaveLength(1);
    expect(litePreviews[0].videoIdx).toBe(0);
    expect(litePreviews[0].frameIdx).toBe(7);
    expect(litePreviews[0].origWidth).toBe(320);
    expect(litePreviews[0].origHeight).toBe(240);
    expect(litePreviews[0].width).toBe(320);
    expect(litePreviews[0].height).toBe(240);
    expect(litePreviews[0].data).toEqual(pf.data);

    // Eager reload
    const loaded = await loadSlp(bytes, { openVideos: false });
    expect(loaded.previewFrames).toHaveLength(1);
    expect(loaded.previewFrames[0].video).toBe(loaded.videos[0]);
    expect(loaded.previewFrames[0].frameIdx).toBe(7);
    expect(loaded.previewFrames[0].data).toEqual(pf.data);

    // Lazy reload + lazy re-save preserves /preview without materializing
    const lazy = await loadSlp(bytes, { openVideos: false, lazy: true });
    expect(lazy.isLazy).toBe(true);
    expect(lazy.previewFrames).toHaveLength(1);
    expect(lazy.previewFrames[0].video).toBe(lazy.videos[0]);

    const lazyBytes = await saveSlpToBytes(lazy, { slpVersion });
    expect(lazy.isLazy).toBe(true);
    const lazyPreviews = await loadSlpPreview(lazyBytes);
    expect(lazyPreviews).toHaveLength(1);
    expect(lazyPreviews[0].data).toEqual(pf.data);
  });

  it("supports preview='auto', false, 0, true, and N with user-frame priority", async () => {
    const skel = new Skeleton({ nodes: ["a", "b"] });
    const video = new Video({
      filename: "mock_video.mp4",
      backend: makeMockBackend(400, 300),
      openBackend: false,
    });
    const frames = [0, 4, 8, 12, 16].map(
      (fidx) =>
        new LabeledFrame({
          video,
          frameIdx: fidx,
          instances: [
            PredictedInstance.fromArray(
              [
                [10, 10],
                [20, 20],
              ],
              skel,
            ),
          ],
        }),
    );
    // Add a user-labeled instance on frame 8
    frames[2].instances.push(
      Instance.fromArray(
        [
          [50, 50],
          [60, 60],
        ],
        skel,
      ),
    );
    const labels = new Labels({
      labeledFrames: frames,
      videos: [video],
      skeletons: [skel],
    });

    // auto captures 1 preview from live backend, preferring user-labeled frame 8
    const autoBytes = await saveSlpToBytes(labels);
    const autoPreviews = await loadSlpPreview(autoBytes);
    expect(autoPreviews).toHaveLength(1);
    expect(autoPreviews[0].frameIdx).toBe(8);
    expect(autoPreviews[0].origWidth).toBe(400);
    expect(autoPreviews[0].origHeight).toBe(300);

    // preview=false and preview=0 omit /preview
    const falseBytes = await saveSlpToBytes(labels, { preview: false });
    expect((await loadSlpMetadata(falseBytes)).hasPreview).toBe(false);
    expect(await loadSlpPreview(falseBytes)).toEqual([]);

    const zeroBytes = await saveSlpToBytes(labels, { preview: 0 });
    expect((await loadSlpMetadata(zeroBytes)).hasPreview).toBe(false);

    // preview=3 captures 3 distinct frames including frame 8
    const threeBytes = await saveSlpToBytes(labels, { preview: 3 });
    const threePreviews = await loadSlpPreview(threeBytes);
    expect(threePreviews).toHaveLength(3);
    expect(new Set(threePreviews.map((p) => p.frameIdx)).size).toBe(3);
    expect(threePreviews.map((p) => p.frameIdx)).toContain(8);

    // Embedded save skips /preview under preview='auto'
    const pkgBytes = await saveSlpToBytes(labels, { embed: "user" });
    expect((await loadSlpMetadata(pkgBytes)).hasPreview).toBe(false);

    // Validation errors reject before writing
    await expect(saveSlpToBytes(labels, { preview: -1 })).rejects.toThrow(
      /preview/,
    );
    await expect(
      saveSlpToBytes(labels, { preview: "bad" as any }),
    ).rejects.toThrow(/preview/);
  });

  it("remaps previewFrames across copy(), extract(), replaceVideos(), and removeVideos()", () => {
    const v1 = new Video({ filename: "v1.mp4", openBackend: false });
    const v2 = new Video({ filename: "v2.mp4", openBackend: false });
    const pf1 = new PreviewFrame({
      video: v1,
      frameIdx: 0,
      origWidth: 100,
      origHeight: 100,
      width: 100,
      height: 100,
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    const pf2 = new PreviewFrame({
      video: v2,
      frameIdx: 3,
      origWidth: 100,
      origHeight: 100,
      width: 100,
      height: 100,
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video: v1, frameIdx: 0 }),
        new LabeledFrame({ video: v2, frameIdx: 3 }),
      ],
      videos: [v1, v2],
      previewFrames: [pf1, pf2],
    });

    const copied = labels.copy({ openVideos: false });
    expect(copied.previewFrames).toHaveLength(2);
    expect(copied.previewFrames[0].video).toBe(copied.videos[0]);
    expect(copied.previewFrames[1].video).toBe(copied.videos[1]);
    expect(copied.previewFrames[0].video).not.toBe(v1);

    const extracted = labels.extract([0]);
    expect(extracted.previewFrames).toHaveLength(1);
    expect(extracted.previewFrames[0].video).toBe(extracted.videos[0]);

    const v1New = new Video({ filename: "v1_new.mp4", openBackend: false });
    copied.replaceVideos({ videoMap: new Map([[copied.videos[0], v1New]]) });
    expect(copied.previewFrames[0].video).toBe(v1New);

    copied.removeVideos([v1New]);
    expect(copied.previewFrames).toHaveLength(1);
    expect(copied.previewFrames[0].video).toBe(copied.videos[0]);
  });
});
