/**
 * `createVideoBackend(..., { grayscale })` — the factory-level entry point for
 * grayscale-forcing (port of Python `Video.from_filename(..., grayscale)`).
 *
 * Exercises the real `ImageVideoBackend` path end-to-end (real PNG bytes,
 * decoded via `skia-canvas`) through the public factory API, for forced
 * true/false and autodetect — closing the gap flagged in the Python test
 * inventory research (no direct forced-True/False test exists for
 * `ImageVideo` upstream; only incidental/autodetect coverage does).
 */
import { describe, it, expect } from "../bun-test";
import { createVideoBackend } from "../../src/video/factory.js";
import { GrayscaleVideoBackend } from "../../src/video/grayscale-backend.js";
import { ImageVideoBackend } from "../../src/video/image-video.js";
import { setImageBytesReader } from "../../src/video/image-source.js";
import type { RawFrame } from "../../src/transform/frame.js";

async function makePng(
  w: number,
  h: number,
  rgb: [number, number, number],
): Promise<Uint8Array> {
  const sc = await import("skia-canvas");
  const canvas = new sc.Canvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(await canvas.toBuffer("png"));
}

describe("createVideoBackend — omitted grayscale option (default, unwrapped)", () => {
  it("returns the plain ImageVideoBackend, not wrapped", async () => {
    const red = await makePng(2, 2, [255, 0, 0]);
    setImageBytesReader(async () => red);
    try {
      const be = await createVideoBackend(["a.png"] as unknown as string);
      expect(be).toBeInstanceOf(ImageVideoBackend);
      expect(be instanceof GrayscaleVideoBackend).toBe(false);
    } finally {
      setImageBytesReader(null);
    }
  });
});

describe("createVideoBackend — grayscale: true (color source)", () => {
  it("wraps the backend and forces every frame to 1 channel", async () => {
    const red = await makePng(3, 3, [200, 20, 20]);
    setImageBytesReader(async () => red);
    try {
      const be = await createVideoBackend(["a.png"] as unknown as string, {
        grayscale: true,
      });
      expect(be).toBeInstanceOf(GrayscaleVideoBackend);
      expect(be.shape).toEqual([1, 3, 3, 1]);
      const frame = (await be.getFrame(0)) as RawFrame;
      expect(frame.channels).toBe(1);
      expect(frame.data[0]).toBe(200); // R channel of rgb(200,20,20).
    } finally {
      setImageBytesReader(null);
    }
  });
});

describe("createVideoBackend — grayscale: false", () => {
  it("never collapses a genuinely-color source (frame stays full RGBA)", async () => {
    const red = await makePng(3, 3, [200, 20, 20]);
    setImageBytesReader(async () => red);
    try {
      const be = await createVideoBackend(["r.png"] as unknown as string, {
        grayscale: false,
      });
      const frame = (await be.getFrame(0)) as ImageData;
      expect(frame.data.length).toBe(3 * 3 * 4);
      expect(frame.data[0]).toBe(200);
    } finally {
      setImageBytesReader(null);
    }
  });

  it(
    "forces the reported shape to 3 channels even when the inner " +
      "ImageVideoBackend already auto-detected 1-channel at its own " +
      "construction time (Python img_shape parity)",
    async () => {
      const gray = await makePng(3, 3, [128, 128, 128]);
      setImageBytesReader(async () => gray);
      try {
        const be = await createVideoBackend(["g.png"] as unknown as string, {
          grayscale: false,
        });
        // ImageVideoBackend.create() already resolved its OWN shape to
        // channels=1 for this genuinely-gray source, independent of the
        // grayscale-wrapping option; `grayscale: false` must still positively
        // override that to 3, or `Video.grayscale`'s shape-driven getter
        // would read this video back as grayscale despite the explicit false.
        expect(be.shape).toEqual([1, 3, 3, 3]);
      } finally {
        setImageBytesReader(null);
      }
    },
  );
});

describe("createVideoBackend — grayscale: null (autodetect)", () => {
  it("resolves true for a genuinely-gray source after the first frame read", async () => {
    const gray = await makePng(2, 2, [64, 64, 64]);
    setImageBytesReader(async () => gray);
    try {
      const be = await createVideoBackend(["g.png"] as unknown as string, {
        grayscale: null,
      });
      expect(be).toBeInstanceOf(GrayscaleVideoBackend);
      const frame = (await be.getFrame(0)) as RawFrame;
      expect(frame.channels).toBe(1);
      expect((be as GrayscaleVideoBackend).grayscale).toBe(true);
    } finally {
      setImageBytesReader(null);
    }
  });

  it("resolves false for a genuinely-color source after the first frame read", async () => {
    // R (10) !== B (90): genuinely color under the R-vs-B detection rule.
    const red = await makePng(2, 2, [10, 200, 90]);
    setImageBytesReader(async () => red);
    try {
      const be = await createVideoBackend(["r.png"] as unknown as string, {
        grayscale: null,
      });
      await be.getFrame(0);
      expect((be as GrayscaleVideoBackend).grayscale).toBe(false);
    } finally {
      setImageBytesReader(null);
    }
  });
});
