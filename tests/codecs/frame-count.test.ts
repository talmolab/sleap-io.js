/**
 * Unit tests for resolveSourceFrameCount — the synchronous source-frame-count
 * resolution used by the SLP readers for embedded videos.
 *
 * Regression context: multi-video pkg.slp files written without a `frames`
 * HDF5 attribute (e.g. older PyQt SLEAP) used to fall into an async per-video
 * image-decode probe whose result raced the UI and reported 0 / "?" / wrong
 * frame counts. The count must instead be derivable synchronously from
 * frame_numbers (max + 1) so every embedded video resolves a shape at read
 * time.
 */

import { describe, it, expect } from "../bun-test";
import { resolveSourceFrameCount } from "../../src/codecs/slp/frame-count.js";

describe("resolveSourceFrameCount", () => {
  it("prefers the `frames` attr (the true source frame count)", () => {
    expect(
      resolveSourceFrameCount({
        framesAttr: 180000,
        jsonFrameCount: 23,
        frameNumbers: [5, 100],
      }),
    ).toBe(180000);
  });

  it("falls back to the videos_json frame count when no `frames` attr", () => {
    expect(
      resolveSourceFrameCount({ jsonFrameCount: 1200, frameNumbers: [5] }),
    ).toBe(1200);
  });

  it("derives max(frame_numbers)+1 when neither attr nor json count exists (PyQt pkg.slp)", () => {
    // mice_hc video0: frame_numbers up to 12167 -> seekbar extent 12168.
    expect(
      resolveSourceFrameCount({ frameNumbers: [214, 705, 12167] }),
    ).toBe(12168);
  });

  it("returns undefined when nothing is available", () => {
    expect(resolveSourceFrameCount({})).toBeUndefined();
    expect(resolveSourceFrameCount({ frameNumbers: [] })).toBeUndefined();
  });

  it("ignores non-positive attr / json counts and still uses frame_numbers", () => {
    expect(
      resolveSourceFrameCount({
        framesAttr: 0,
        jsonFrameCount: 0,
        frameNumbers: [3, 9],
      }),
    ).toBe(10);
  });
});
