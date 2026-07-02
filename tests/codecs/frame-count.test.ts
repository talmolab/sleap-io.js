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
    expect(resolveSourceFrameCount({ frameNumbers: [214, 705, 12167] })).toBe(
      12168,
    );
  });

  it("clamps up to max(frame_numbers)+1 when a declared count is impossibly small (bogus `frames` attr)", () => {
    // Real case: /video0/video has frames=424 but frame_numbers reach 173997 —
    // a 424-frame source cannot contain frame 173997, so the seekbar extent must
    // span at least 173998 or every label beyond 424 falls off the axis.
    expect(
      resolveSourceFrameCount({
        framesAttr: 424,
        jsonFrameCount: 336,
        frameNumbers: [76978, 100000, 173997],
      }),
    ).toBe(173998);
    // Same guard when only videos_json shape[0] is the (too-small) declared count.
    expect(
      resolveSourceFrameCount({ jsonFrameCount: 336, frameNumbers: [173997] }),
    ).toBe(173998);
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
