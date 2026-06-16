/**
 * Integration test: an embedded pkg.slp written WITHOUT a `frames` HDF5 attr
 * and without a videos_json shape (e.g. older PyQt SLEAP) must still resolve a
 * full video shape — [max(frame_numbers)+1, H, W, C] — from the dataset attrs
 * and frame_numbers, on BOTH readers.
 *
 * Regression: previously the eager reader returned shape === null for such a
 * file (it gated shape on a 4-length JSON shape and had no max(frame_numbers)+1
 * fallback), while the streaming reader was being fixed to resolve it. This
 * keeps the two readers in parity. The streaming (Worker) path can't run under
 * Node, so the eager path is the runnable end-to-end check of the shared
 * resolveSourceFrameCount logic.
 */

import { describe, it, expect } from "../bun-test";
import { readSlp } from "../../src/codecs/slp/read.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE = path.join(
  fileURLToPath(new URL("../data", import.meta.url)),
  "slp",
  "minimal_instance.pkg.slp",
);

describe("eager reader: embedded pkg.slp without a `frames` attr", () => {
  it("resolves [max(frame_numbers)+1, H, W, C] from dataset attrs + frame_numbers", async () => {
    const labels = await readSlp(FIXTURE, { openVideos: true });
    const video = labels.videos[0];
    // Fixture: no `frames` attr; dataset attrs height=384 width=384 channels=1;
    // frame_numbers = [0] -> source extent 0 + 1 = 1.
    expect(video.shape).toEqual([1, 384, 384, 1]);
  });
});
