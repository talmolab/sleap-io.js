/**
 * Read-side point-span validation (issue #230).
 *
 * Points are positional: row `k` of an instance's `point_id_start:point_id_end`
 * slice is node `k`. When a span's length differs from the skeleton's node
 * count, the readers used to pad/cut each instance and silently put
 * coordinates on the wrong nodes. They now refuse such files (like Python
 * sleap-io), and `repairPointSpans` rebuilds the spans when that's exact.
 * Files are crafted by tests/slp-point-span-files.ts.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import {
  checkPointSpans,
  SlpPointSpanError,
} from "../src/codecs/slp/point-spans.js";
import { loadSlp } from "../src/io/main.js";
import * as nodeIndex from "../src/index.js";
import * as browserIndex from "../src/index.browser.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import type { Labels } from "../src/model/labels.js";
import { Skeleton } from "../src/model/skeleton.js";
import {
  makeSpanLabels,
  makeStreamingFile,
  shiftBoundary,
  spanCoord,
  SPAN_NODES,
  writeSlpWithSpans,
} from "./slp-point-span-files.js";

/** Every instance's points, in file order. */
function allPoints(labels: Labels): number[][][] {
  const frames = labels.isLazy
    ? Array.from({ length: labels.length }, (_, i) => labels.frameAt(i)!)
    : labels.labeledFrames;
  return frames.flatMap((lf) =>
    lf.instances.map((inst) => inst.points.map((p) => [...p.xy])),
  );
}

/** What `allPoints` returns for an intact file of `count` instances. */
function expectedPoints(count: number): number[][][] {
  return Array.from({ length: count }, (_, i) =>
    SPAN_NODES.map((_, node) => spanCoord(i, node)),
  );
}

/** Await `promise` and return the SlpPointSpanError it rejects with. */
async function spanError(
  promise: Promise<unknown>,
): Promise<SlpPointSpanError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(SlpPointSpanError);
    return e as SlpPointSpanError;
  }
  throw new Error("expected the read to throw SlpPointSpanError");
}

const buf = (bytes: Uint8Array) => bytes.buffer as ArrayBuffer;

/** The #231 pattern: rows 1 and 2 (across frames) span 3 and 5 of 4 nodes. */
const shifted = () => writeSlpWithSpans(makeSpanLabels(), shiftBoundary(1, -1));

function readStreaming(
  file: StreamingH5File,
  opts: { lazy?: boolean; userInstancesOnly?: boolean; repair?: boolean },
) {
  return readFromStreamingFile(
    file,
    "spans.slp",
    "spans.slp",
    false,
    undefined,
    false,
    opts.lazy ?? false,
    false,
    opts.userInstancesOnly ?? false,
    opts.repair ?? false,
  );
}

// The core bug: a shifted span boundary must fail loudly, naming where it is.
describe("readSlp refuses point spans that don't match the skeleton", () => {
  it("throws SlpPointSpanError describing the first bad instance", async () => {
    const { bytes } = await shifted();
    const err = await spanError(readSlp(buf(bytes), { openVideos: false }));
    expect(err.mismatchCount).toBe(2);
    expect(err.instanceCount).toBe(4);
    expect(err.first).toEqual({
      instanceRow: 1,
      instanceType: "predicted",
      pointStart: 4,
      pointEnd: 7,
      span: 3,
      nodeCount: 4,
      skeletonName: "fly",
      frameIdx: 0,
      videoIndex: 0,
      videoFilename: "span-test.mp4",
    });
    expect(err.message).toContain("2 of 4 instances");
    expect(err.message).toContain("frame 0 of video 0 (span-test.mp4)");
    expect(err.message).toContain("pred_points rows (4–7)");
    expect(err.message).toContain("repairPointSpans");
  });

  it("names the points table for user instances", async () => {
    const { bytes } = await writeSlpWithSpans(
      makeSpanLabels(["uu", "uu"]),
      shiftBoundary(2, 1),
    );
    const err = await spanError(readSlp(buf(bytes), { openVideos: false }));
    expect(err.first.instanceType).toBe("user");
    expect(err.first.instanceRow).toBe(2);
    expect(err.first.frameIdx).toBe(10);
    expect(err.message).toContain("5 points rows (8–13)");
  });

  it("loadSlp (Node) rejects the file the same way", async () => {
    const { bytes } = await shifted();
    await spanError(loadSlp(buf(bytes), { openVideos: false }));
  });

  it("is exported from both entry points", () => {
    expect(nodeIndex.SlpPointSpanError).toBe(SlpPointSpanError);
    expect(browserIndex.SlpPointSpanError).toBe(SlpPointSpanError);
  });
});

// The opt-in repair must give back exactly the coordinates that were written.
describe("repairPointSpans", () => {
  it("restores every instance's nodes on a shifted file (readSlp)", async () => {
    const { bytes } = await shifted();
    const labels = await readSlp(buf(bytes), {
      openVideos: false,
      repairPointSpans: true,
    });
    expect(allPoints(labels)).toEqual(expectedPoints(4));
  });

  it("works through loadSlp", async () => {
    const { bytes } = await shifted();
    const labels = await loadSlp(buf(bytes), {
      openVideos: false,
      repairPointSpans: true,
    });
    expect(allPoints(labels)).toEqual(expectedPoints(4));
  });

  it("repairs user and predicted tables independently in a mixed file", async () => {
    // Rows alternate user/predicted; shift one boundary in each table.
    const { bytes } = await writeSlpWithSpans(
      makeSpanLabels(["up", "up"]),
      (spans) => {
        // user rows 0 and 2, predicted rows 1 and 3
        spans[0][1] += 1;
        spans[2][0] += 1;
        spans[1][1] -= 2;
        spans[3][0] -= 2;
        return spans;
      },
    );
    await spanError(readSlp(buf(bytes), { openVideos: false }));
    const labels = await readSlp(buf(bytes), {
      openVideos: false,
      repairPointSpans: true,
    });
    expect(allPoints(labels)).toEqual(expectedPoints(4));
  });

  it("is a no-op on a clean file", async () => {
    const { bytes } = await writeSlpWithSpans(makeSpanLabels(), (s) => s);
    for (const repairPointSpans of [false, true]) {
      const labels = await readSlp(buf(bytes), {
        openVideos: false,
        repairPointSpans,
      });
      expect(allPoints(labels)).toEqual(expectedPoints(4));
    }
  });

  it("refuses when the spans don't cover the whole point table", async () => {
    const { bytes } = await writeSlpWithSpans(makeSpanLabels(), (spans) => {
      spans[3][1] -= 1; // last instance stops one row short
      return spans;
    });
    const err = await spanError(
      readSlp(buf(bytes), { openVideos: false, repairPointSpans: true }),
    );
    expect(err.repairRefusedReason).toBe(
      "the spans cover 15 pred_points rows, but the table has 16",
    );
    expect(err.message).toContain("Repair refused");
  });

  it("refuses when two instances overlap", async () => {
    const { bytes } = await writeSlpWithSpans(makeSpanLabels(), (spans) => {
      spans[2][0] -= 1; // row 2 re-reads row 1's last point
      return spans;
    });
    const err = await spanError(
      readSlp(buf(bytes), { openVideos: false, repairPointSpans: true }),
    );
    expect(err.repairRefusedReason).toBe(
      "instance row 2 starts at pred_points row 7, but the previous instance ended at row 8",
    );
  });
});

// The lazy reader builds frames on demand, so it must check at open time.
describe("readSlpLazy point spans", () => {
  it("throws on open, before any frame is built", async () => {
    const { bytes } = await shifted();
    await spanError(readSlpLazy(buf(bytes), { openVideos: false }));
  });

  it("repairs, and a re-save writes the fixed spans", async () => {
    const { bytes } = await shifted();
    const labels = await readSlpLazy(buf(bytes), {
      openVideos: false,
      repairPointSpans: true,
    });
    expect(labels.isLazy).toBe(true);
    expect(allPoints(labels)).toEqual(expectedPoints(4));

    const resaved = await saveSlpToBytes(labels);
    const strict = await readSlp(buf(resaved), { openVideos: false });
    expect(allPoints(strict)).toEqual(expectedPoints(4));
  });
});

// readSlpStreaming (#230's `frameAt` path) runs the same check.
describe("readSlpStreaming point spans", () => {
  for (const lazy of [false, true]) {
    it(`throws, and repairs on request (lazy: ${lazy})`, async () => {
      const { bytes } = await shifted();
      const { file, close } = await makeStreamingFile(bytes);
      try {
        await spanError(readStreaming(file, { lazy }));
        const labels = await readStreaming(file, { lazy, repair: true });
        expect(labels.isLazy).toBe(lazy);
        expect(allPoints(labels)).toEqual(expectedPoints(4));
      } finally {
        close();
      }
    });
  }

  it("userInstancesOnly ignores bad spans on predicted instances it skips", async () => {
    // Only the predicted rows (1 and 3) are off; the user rows are fine.
    const { bytes } = await writeSlpWithSpans(
      makeSpanLabels(["up", "up"]),
      (spans) => {
        spans[1][1] -= 1;
        spans[3][0] -= 1;
        return spans;
      },
    );
    const { file, close } = await makeStreamingFile(bytes);
    try {
      await spanError(readStreaming(file, {}));
      const labels = await readStreaming(file, { userInstancesOnly: true });
      const user = labels.labeledFrames.flatMap((lf) =>
        lf.instances.map((inst) => inst.points.map((p) => [...p.xy])),
      );
      // user instances are global instances 0 and 2
      expect(user).toEqual([expectedPoints(4)[0], expectedPoints(4)[2]]);
    } finally {
      close();
    }
  });
});

// Direct checks of the shared helper the three readers call.
describe("checkPointSpans", () => {
  const skeletons = [new Skeleton({ nodes: ["a", "b"] })];
  const table = () => ({
    framesData: {
      frame_id: [0],
      video: [0],
      frame_idx: [0],
      instance_id_start: [0],
      instance_id_end: [2],
    },
    instancesData: {
      instance_type: [1, 1],
      skeleton: [0, 0],
      point_id_start: [0, 1],
      point_id_end: [1, 5],
    } as Record<string, ArrayLike<unknown> | undefined>,
  });

  it("leaves the instances table untouched when it refuses a repair", () => {
    const { framesData, instancesData } = table();
    const before = structuredClone(instancesData);
    expect(() =>
      checkPointSpans({
        framesData,
        instancesData,
        skeletons,
        videos: [],
        pointsRowCount: 0,
        predPointsRowCount: 5, // 4 rows needed for two 2-node instances
        repair: true,
      }),
    ).toThrow(SlpPointSpanError);
    expect(instancesData).toEqual(before);
  });

  it("rewrites the spans as consecutive node-count runs", () => {
    const { framesData, instancesData } = table();
    instancesData.point_id_end = [1, 4]; // 1 + 3 rows for two 2-node instances
    const result = checkPointSpans({
      framesData,
      instancesData,
      skeletons,
      videos: [],
      pointsRowCount: 0,
      predPointsRowCount: 4,
      repair: true,
    });
    expect(result.repairedInstances).toBe(2);
    expect(instancesData.point_id_start).toEqual([0, 2]);
    expect(instancesData.point_id_end).toEqual([2, 4]);
  });

  it("skips tables without span columns", () => {
    const { framesData } = table();
    expect(
      checkPointSpans({
        framesData,
        instancesData: { instance_type: [0] },
        skeletons,
        videos: [],
        pointsRowCount: 0,
        predPointsRowCount: 0,
      }),
    ).toEqual({ repairedInstances: 0 });
  });
});
