/**
 * Shared-decode mosaic tests (Item 2 of JS issue #153).
 *
 * Locks in the decision (mirroring Python `slp.py:393-401`):
 *  - In-memory `Video.crop({ shareDecode: true })` (the default) reuses ONE
 *    inner decoder across sibling tiles (ownsInner=false), so closing one tile
 *    does NOT tear down its siblings — the caller owns the shared inner.
 *  - `Video.crop({ shareDecode: false })` gives the tile its OWN inner
 *    (ownsInner=true), whose close() cascades to the inner.
 *
 * No real decode / network: the inner is an in-memory spy backend.
 */
import { describe, it, expect } from "../bun-test";
import { Video } from "../../src/model/video.js";
import type { CropVideoBackend } from "../../src/video/crop-backend.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";

/**
 * A spy source backend: counts `getFrame` calls (decode sites) and records
 * whether `close()` was called. Returns a tiny readable RGBA `ImageData`-shaped
 * frame so the crop wrapper can crop it synchronously on Node (no decode).
 */
interface SpyBackend extends VideoBackend {
  decodeCount: number;
  closed: boolean;
}

function makeSpy(width = 8, height = 4): SpyBackend {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;
  return {
    filename: "/data/mosaic.mp4",
    shape: [1, height, width, 1],
    dataset: null,
    decodeCount: 0,
    closed: false,
    async getFrame(): Promise<VideoFrame | null> {
      this.decodeCount++;
      return {
        data,
        width,
        height,
        colorSpace: "srgb",
      } as unknown as ImageData;
    },
    close() {
      this.closed = true;
    },
  };
}

describe("Video.crop shared-decode (Item 2)", () => {
  it("tiles of one source share ONE inner (the shared inner is the single decode site)", async () => {
    const spy = makeSpy(8, 4);
    const src = new Video({ backend: spy });

    const tileA = src.crop([0, 0, 4, 4], { shareDecode: true });
    const tileB = src.crop([4, 0, 8, 4], { shareDecode: true });

    const innerA = (tileA.backend as CropVideoBackend).inner;
    const innerB = (tileB.backend as CropVideoBackend).inner;
    // Same object, and that object is literally the source spy.
    expect(innerA).toBe(spy);
    expect(innerB).toBe(spy);
    expect(innerA).toBe(innerB);

    // Reading one frame from each tile decodes the shared inner once per read.
    await tileA.getFrame(0);
    await tileB.getFrame(0);
    expect(spy.decodeCount).toBe(2);
  });

  it("closing one tile does NOT tear down siblings sharing the inner", async () => {
    const spy = makeSpy(8, 4);
    const src = new Video({ backend: spy });
    const tileA = src.crop([0, 0, 4, 4], { shareDecode: true });
    const tileB = src.crop([4, 0, 8, 4], { shareDecode: true });

    tileA.close();
    // Shared inner untouched (ownsInner=false on the tile).
    expect(spy.closed).toBe(false);
    // Sibling still reads.
    const frame = (await tileB.getFrame(0)) as ImageData;
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);

    tileB.close();
    // No tile owns the shared inner — the caller does, by design.
    expect(spy.closed).toBe(false);
  });

  it("default shareDecode (no opt-in) shares the inner", () => {
    const spy = makeSpy(8, 4);
    const src = new Video({ backend: spy });
    const tile = src.crop([0, 0, 4, 4]); // shareDecode defaults to true
    const cb = tile.backend as CropVideoBackend;
    expect(cb.inner).toBe(spy);
    expect(cb.ownsInner).toBe(false);
  });

  it("shareDecode:false gives the tile its OWN inner whose close() cascades", () => {
    const spy = makeSpy(8, 4);
    const src = new Video({ backend: spy });
    const tile = src.crop([0, 0, 4, 4], { shareDecode: false });
    const cb = tile.backend as CropVideoBackend;
    expect(cb.ownsInner).toBe(true);
    expect(spy.closed).toBe(false);
    tile.close();
    expect(spy.closed).toBe(true);
  });
});
