import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderImage, toPNG, toJPEG, toDataURL } from "../../src/rendering/render";
import { RenderContext, InstanceContext } from "../../src/rendering/context";
import { Skeleton } from "../../src/model/skeleton";
import { Instance, Track } from "../../src/model/instance";
import { LabeledFrame } from "../../src/model/labeled-frame";
import { Labels } from "../../src/model/labels";
import { Video } from "../../src/model/video";

// Create a simple skeleton for testing
function createTestSkeleton(): Skeleton {
  return new Skeleton({
    nodes: ["head", "neck", "tail"],
    edges: [
      ["head", "neck"],
      ["neck", "tail"],
    ],
  });
}

// Create a test instance with valid points
function createTestInstance(skeleton: Skeleton, track?: Track): Instance {
  return new Instance({
    points: {
      head: [50, 30],
      neck: [50, 50],
      tail: [50, 80],
    },
    skeleton,
    track,
  });
}

// Create a test video mock
function createTestVideo(): Video {
  return new Video({ filename: "test.mp4" });
}

describe("renderImage", () => {
  let skeleton: Skeleton;
  let instance: Instance;

  beforeEach(() => {
    skeleton = createTestSkeleton();
    instance = createTestInstance(skeleton);
  });

  describe("with Instance array", () => {
    it("renders a single instance with width/height options", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
      });

      expect(imageData).toBeDefined();
      expect(imageData.width).toBe(100);
      expect(imageData.height).toBe(100);
      expect(imageData.data).toBeInstanceOf(Uint8ClampedArray);
    });

    it("renders multiple instances", async () => {
      const instance2 = createTestInstance(skeleton);
      instance2.points[0].xy = [70, 30]; // Move head to different position

      const imageData = await renderImage([instance, instance2], {
        width: 100,
        height: 100,
      });

      expect(imageData).toBeDefined();
      expect(imageData.width).toBe(100);
      expect(imageData.height).toBe(100);
    });

    it("throws when no instances and no image provided", async () => {
      await expect(renderImage([], { width: 100, height: 100 })).rejects.toThrow(
        "No instances to render"
      );
    });

    it("throws when no frame size can be determined", async () => {
      await expect(renderImage([instance], {})).rejects.toThrow(
        "Cannot determine frame size"
      );
    });
  });

  describe("with LabeledFrame", () => {
    it("renders a LabeledFrame", async () => {
      const video = createTestVideo();
      const frame = new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [instance],
      });

      const imageData = await renderImage(frame, {
        width: 100,
        height: 100,
      });

      expect(imageData).toBeDefined();
      expect(imageData.width).toBe(100);
      expect(imageData.height).toBe(100);
    });
  });

  describe("with Labels", () => {
    it("renders first frame from Labels", async () => {
      const video = createTestVideo();
      const frame = new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [instance],
      });
      const labels = new Labels({
        labeledFrames: [frame],
        skeletons: [skeleton],
      });

      const imageData = await renderImage(labels, {
        width: 100,
        height: 100,
      });

      expect(imageData).toBeDefined();
      expect(imageData.width).toBe(100);
    });
  });

  describe("rendering options", () => {
    it("applies scale factor", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
        scale: 2,
      });

      expect(imageData.width).toBe(200);
      expect(imageData.height).toBe(200);
    });

    it("renders with transparent background by default", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
      });

      // Check that some pixels are transparent (alpha = 0)
      // Find a pixel that should be transparent (corner)
      const cornerIdx = 0; // top-left pixel
      const alpha = imageData.data[cornerIdx * 4 + 3];
      expect(alpha).toBe(0);
    });

    it("renders with solid background", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
        background: [255, 0, 0], // Red background
      });

      // Check corner pixel is red
      const cornerIdx = 0;
      expect(imageData.data[cornerIdx * 4 + 0]).toBe(255); // R
      expect(imageData.data[cornerIdx * 4 + 1]).toBe(0); // G
      expect(imageData.data[cornerIdx * 4 + 2]).toBe(0); // B
      expect(imageData.data[cornerIdx * 4 + 3]).toBe(255); // A
    });

    it("can disable nodes rendering", async () => {
      const imageDataWithNodes = await renderImage([instance], {
        width: 100,
        height: 100,
        showNodes: true,
        showEdges: false,
        background: [255, 255, 255],
      });

      const imageDataWithoutNodes = await renderImage([instance], {
        width: 100,
        height: 100,
        showNodes: false,
        showEdges: false,
        background: [255, 255, 255],
      });

      // The image without nodes should be all white
      // The image with nodes should have some colored pixels
      // Check a pixel near where a node should be (50, 50)
      const nodeX = 50;
      const nodeY = 50;
      const idx = (nodeY * 100 + nodeX) * 4;

      // Without nodes, should be white background
      expect(imageDataWithoutNodes.data[idx]).toBe(255);
      expect(imageDataWithoutNodes.data[idx + 1]).toBe(255);
      expect(imageDataWithoutNodes.data[idx + 2]).toBe(255);

      // With nodes, center pixel should be different (colored node)
      // The node is drawn on top, so it should be a palette color
      const hasColoredPixel =
        imageDataWithNodes.data[idx] !== 255 ||
        imageDataWithNodes.data[idx + 1] !== 255 ||
        imageDataWithNodes.data[idx + 2] !== 255;
      expect(hasColoredPixel).toBe(true);
    });

    it("can disable edges rendering", async () => {
      const imageDataWithEdges = await renderImage([instance], {
        width: 100,
        height: 100,
        showNodes: false,
        showEdges: true,
        background: [255, 255, 255],
      });

      const imageDataWithoutEdges = await renderImage([instance], {
        width: 100,
        height: 100,
        showNodes: false,
        showEdges: false,
        background: [255, 255, 255],
      });

      // Images should differ since one has edges
      const pixelsWithEdges = Array.from(imageDataWithEdges.data);
      const pixelsWithoutEdges = Array.from(imageDataWithoutEdges.data);

      expect(pixelsWithEdges).not.toEqual(pixelsWithoutEdges);
    });

    it("supports different marker shapes", async () => {
      const shapes = ["circle", "square", "diamond", "triangle", "cross"] as const;

      for (const shape of shapes) {
        const imageData = await renderImage([instance], {
          width: 100,
          height: 100,
          markerShape: shape,
        });

        expect(imageData).toBeDefined();
        expect(imageData.width).toBe(100);
      }
    });

    it("supports different color schemes", async () => {
      const schemes = ["track", "instance", "node", "auto"] as const;

      for (const scheme of schemes) {
        const imageData = await renderImage([instance], {
          width: 100,
          height: 100,
          colorBy: scheme,
        });

        expect(imageData).toBeDefined();
      }
    });

    it("supports different palettes", async () => {
      const palettes = [
        "standard",
        "tableau10",
        "distinct",
        "viridis",
        "rainbow",
      ] as const;

      for (const palette of palettes) {
        const imageData = await renderImage([instance], {
          width: 100,
          height: 100,
          palette,
        });

        expect(imageData).toBeDefined();
      }
    });
  });

  describe("callbacks", () => {
    it("calls preRenderCallback before rendering", async () => {
      const callback = vi.fn();

      await renderImage([instance], {
        width: 100,
        height: 100,
        preRenderCallback: callback,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const ctx = callback.mock.calls[0][0];
      expect(ctx).toBeInstanceOf(RenderContext);
      expect(ctx.frameIdx).toBe(0);
      expect(ctx.frameSize).toEqual([100, 100]);
      expect(ctx.instances).toHaveLength(1);
    });

    it("calls postRenderCallback after rendering", async () => {
      const callback = vi.fn();

      await renderImage([instance], {
        width: 100,
        height: 100,
        postRenderCallback: callback,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      const ctx = callback.mock.calls[0][0];
      expect(ctx).toBeInstanceOf(RenderContext);
    });

    it("calls perInstanceCallback for each instance", async () => {
      const instance2 = createTestInstance(skeleton);
      const callback = vi.fn();

      await renderImage([instance, instance2], {
        width: 100,
        height: 100,
        perInstanceCallback: callback,
      });

      expect(callback).toHaveBeenCalledTimes(2);

      const ctx1 = callback.mock.calls[0][0];
      expect(ctx1).toBeInstanceOf(InstanceContext);
      expect(ctx1.instanceIdx).toBe(0);

      const ctx2 = callback.mock.calls[1][0];
      expect(ctx2.instanceIdx).toBe(1);
    });
  });

  describe("track coloring", () => {
    it("colors instances by track when tracks are present", async () => {
      const track1 = new Track("animal1");
      const track2 = new Track("animal2");

      const instance1 = createTestInstance(skeleton, track1);
      const instance2 = createTestInstance(skeleton, track2);
      instance2.points[0].xy = [70, 30];

      const imageData = await renderImage([instance1, instance2], {
        width: 100,
        height: 100,
        colorBy: "track",
      });

      expect(imageData).toBeDefined();
    });
  });

  describe("handles missing points", () => {
    it("skips NaN points gracefully", async () => {
      const instanceWithNaN = new Instance({
        points: {
          head: [Number.NaN, Number.NaN], // Missing point
          neck: [50, 50],
          tail: [50, 80],
        },
        skeleton,
      });

      const imageData = await renderImage([instanceWithNaN], {
        width: 100,
        height: 100,
      });

      expect(imageData).toBeDefined();
      // Should render without throwing
    });
  });
});

describe("export utilities", () => {
  let skeleton: Skeleton;
  let instance: Instance;

  beforeEach(() => {
    skeleton = createTestSkeleton();
    instance = new Instance({
      points: {
        head: [50, 30],
        neck: [50, 50],
        tail: [50, 80],
      },
      skeleton,
    });
  });

  describe("toPNG", () => {
    it("converts ImageData to PNG buffer", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
      });

      const pngBuffer = await toPNG(imageData);

      expect(pngBuffer).toBeInstanceOf(Buffer);
      // PNG magic number: 0x89 0x50 0x4E 0x47
      expect(pngBuffer[0]).toBe(0x89);
      expect(pngBuffer[1]).toBe(0x50);
      expect(pngBuffer[2]).toBe(0x4e);
      expect(pngBuffer[3]).toBe(0x47);
    });
  });

  describe("toJPEG", () => {
    it("converts ImageData to JPEG buffer", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
        background: [255, 255, 255], // JPEG needs opaque background
      });

      const jpegBuffer = await toJPEG(imageData);

      expect(jpegBuffer).toBeInstanceOf(Buffer);
      // JPEG magic number: 0xFF 0xD8 0xFF
      expect(jpegBuffer[0]).toBe(0xff);
      expect(jpegBuffer[1]).toBe(0xd8);
      expect(jpegBuffer[2]).toBe(0xff);
    });

    it("accepts quality parameter", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
        background: [255, 255, 255],
      });

      const lowQuality = await toJPEG(imageData, 0.1);
      const highQuality = await toJPEG(imageData, 0.95);

      // Lower quality should result in smaller file
      expect(lowQuality.length).toBeLessThan(highQuality.length);
    });
  });

  describe("toDataURL", () => {
    it("converts ImageData to data URL", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
      });

      const dataUrl = toDataURL(imageData);

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("supports JPEG format", async () => {
      const imageData = await renderImage([instance], {
        width: 100,
        height: 100,
        background: [255, 255, 255],
      });

      const dataUrl = toDataURL(imageData, "jpeg");

      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });
  });
});

describe("RenderContext", () => {
  it("transforms world to canvas coordinates", () => {
    const ctx = new RenderContext(
      {} as CanvasRenderingContext2D,
      0,
      [100, 100],
      [],
      [],
      [],
      2.0, // scale
      [10, 20] // offset
    );

    const [canvasX, canvasY] = ctx.worldToCanvas(50, 60);

    // (50 - 10) * 2 = 80
    // (60 - 20) * 2 = 80
    expect(canvasX).toBe(80);
    expect(canvasY).toBe(80);
  });
});

describe("InstanceContext", () => {
  it("calculates centroid of valid points", () => {
    const ctx = new InstanceContext(
      {} as CanvasRenderingContext2D,
      0,
      [
        [10, 20],
        [30, 40],
        [Number.NaN, Number.NaN], // Invalid point should be skipped
      ],
      [],
      ["a", "b", "c"]
    );

    const centroid = ctx.getCentroid();

    expect(centroid).toEqual([20, 30]); // (10+30)/2, (20+40)/2
  });

  it("returns null centroid when no valid points", () => {
    const ctx = new InstanceContext(
      {} as CanvasRenderingContext2D,
      0,
      [
        [Number.NaN, Number.NaN],
        [Number.NaN, Number.NaN],
      ],
      [],
      ["a", "b"]
    );

    expect(ctx.getCentroid()).toBeNull();
  });

  it("calculates bounding box", () => {
    const ctx = new InstanceContext(
      {} as CanvasRenderingContext2D,
      0,
      [
        [10, 20],
        [30, 40],
        [20, 50],
      ],
      [],
      ["a", "b", "c"]
    );

    const bbox = ctx.getBbox();

    expect(bbox).toEqual([10, 20, 30, 50]); // [minX, minY, maxX, maxY]
  });

  it("returns null bbox when no valid points", () => {
    const ctx = new InstanceContext(
      {} as CanvasRenderingContext2D,
      0,
      [[Number.NaN, Number.NaN]],
      [],
      ["a"]
    );

    expect(ctx.getBbox()).toBeNull();
  });
});
