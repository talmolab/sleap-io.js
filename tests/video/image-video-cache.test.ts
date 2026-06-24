/**
 * Two-tier frame cache in ImageVideoBackend: a large raw-bytes tier (kills
 * network re-reads) and a small decoded tier (kills re-decode). The defining new
 * property over the old single decoded cache: a frame evicted from the DECODED
 * tier but still present in the BYTES tier re-decodes WITHOUT another reader
 * (network) call.
 *
 * Tests inject a counting reader that returns a real fixture jpg, so decode is
 * exercised for real while reader calls are observable.
 */
import { describe, it, expect } from "../bun-test";
import { ImageVideoBackend } from "../../src/video/image-video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const jpgPath = fileURLToPath(
  new URL("../data/videos/imgs/img.00.jpg", import.meta.url),
);
const realJpg = new Uint8Array(fs.readFileSync(jpgPath));

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `img${i}.jpg`);
}

/** A reader that records each requested path and returns the real jpg bytes. */
function countingReader() {
  const reads: string[] = [];
  const reader = async (p: string): Promise<Uint8Array> => {
    reads.push(p);
    return realJpg;
  };
  return { reader, reads };
}

describe("ImageVideoBackend two-tier cache", () => {
  it("serves a repeated frame from the decoded tier (one reader call)", async () => {
    const { reader, reads } = countingReader();
    const be = await ImageVideoBackend.create({
      filename: names(20),
      shape: [20, 8, 8, 3],
      reader,
    });
    await be.getFrame(3);
    await be.getFrame(3);
    expect(reads.filter((p) => p === "img3.jpg").length).toBe(1);
  });

  it("re-decodes from the bytes tier after a decoded eviction (no re-read)", async () => {
    const { reader, reads } = countingReader();
    const be = await ImageVideoBackend.create({
      filename: names(50),
      shape: [50, 8, 8, 3],
      reader,
      // Decoded tier holds ~one frame (prior decodes evicted); bytes tier roomy
      // enough for all 41 frames touched below.
      decodedCacheBytes: 1,
      bytesCacheBytes: 10_000_000,
    });
    await be.getFrame(0); // read img0, decode
    // Touch 40 more distinct frames — enough to evict decoded[0] from any
    // reasonable decoded tier (and from the old 32-entry FIFO cache).
    for (let i = 1; i <= 40; i++) await be.getFrame(i);
    await be.getFrame(0); // decoded[0] gone -> bytes[0] hit -> decode, NO re-read
    expect(reads.filter((p) => p === "img0.jpg").length).toBe(1);
  });

  it("returns a decoded frame with real dimensions", async () => {
    const { reader } = countingReader();
    const be = await ImageVideoBackend.create({
      filename: names(5),
      shape: [5, 8, 8, 3],
      reader,
    });
    const frame = (await be.getFrame(2)) as ImageData;
    expect(frame).not.toBeNull();
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
  });

  it("returns null for out-of-range indices", async () => {
    const { reader } = countingReader();
    const be = await ImageVideoBackend.create({
      filename: names(5),
      shape: [5, 8, 8, 3],
      reader,
    });
    expect(await be.getFrame(-1)).toBeNull();
    expect(await be.getFrame(5)).toBeNull();
  });
});
