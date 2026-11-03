/**
 * `readSlpStreaming({ userInstancesOnly: true })`: read only user instances and
 * never touch the `pred_points` table (most of a predictions file).
 *
 * Driven through the exported orchestrator `readFromStreamingFile` with a fake
 * `StreamingH5File` (same approach as streaming-lazy.test.ts): compound pose
 * tables come from a real `readSlpLazy` store for the fixture, everything else
 * from `h5wasm/node`. The fake records every dataset read so tests can assert
 * `pred_points` was never requested.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { PredictedInstance } from "../src/model/instance.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const slpPath = (name: string) => path.join(fixtureRoot, "slp", name);

function unwrapAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    out[k] =
      v && typeof v === "object" && "value" in (v as Record<string, unknown>)
        ? (v as { value: unknown }).value
        : v;
  }
  return out;
}

async function makeFakeStreamingFile(fixture: string) {
  const module = await ready;
  try {
    module.FS.mkdir("/tmp");
  } catch {
    // already exists
  }
  const p = `/tmp/streaming_user_only_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
  module.FS.writeFile(p, readFileSync(slpPath(fixture)));
  const h5 = new H5File(p, "r");
  const store = (await readSlpLazy(slpPath(fixture), { openVideos: false }))
    ._lazyDataStore;
  if (!store) throw new Error("readSlpLazy did not produce a lazy store");
  const columns: Record<string, Record<string, unknown[]>> = {
    frames: store.framesData,
    instances: store.instancesData,
    points: store.pointsData,
    pred_points: store.predPointsData,
  };
  const reads: string[] = [];
  const get = (dp: string) => h5.get(dp) as unknown as Record<string, unknown>;
  const fake = {
    keys: () => h5.keys() as string[],
    getKeys: () => h5.keys() as string[],
    getAttrs: async (dp: string) =>
      unwrapAttrs((get(dp)?.attrs as Record<string, unknown>) ?? {}),
    getDatasetMeta: async (dp: string) => {
      const d = get(dp);
      return {
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
    getDatasetValue: async (dp: string) => {
      reads.push(dp.replace(/^\//, ""));
      if (dp in columns) return { value: columns[dp], shape: [], dtype: "" };
      const d = get(dp);
      return {
        value: d?.value,
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
  } as unknown as StreamingH5File;
  return {
    fake,
    reads,
    close: () => {
      h5.close();
      try {
        module.FS.unlink(p);
      } catch {
        // ignore
      }
    },
  };
}

function readStreaming(
  fake: StreamingH5File,
  opts: { lazy?: boolean; userInstancesOnly?: boolean },
) {
  return readFromStreamingFile(
    fake,
    "test.slp",
    "test.slp",
    false,
    undefined,
    false,
    opts.lazy ?? false,
    false,
    opts.userInstancesOnly ?? false,
  );
}

/** Per frame (video index, frame index): the user instances' point coordinates. */
function userFrames(labels: Awaited<ReturnType<typeof readSlp>>) {
  return labels.labeledFrames
    .filter((lf) => lf.userInstances.length > 0)
    .map((lf) => ({
      video: labels.videos.indexOf(lf.video),
      frameIdx: lf.frameIdx,
      points: lf.userInstances.map((inst) => inst.points.map((pt) => pt.xy)),
    }));
}

describe("readSlpStreaming userInstancesOnly", () => {
  it("keeps exactly the user instances of a mixed file, without reading pred_points", async () => {
    const { fake, reads, close } =
      await makeFakeStreamingFile("labels.v002.slp");
    try {
      const labels = await readStreaming(fake, { userInstancesOnly: true });
      const reference = await readSlp(slpPath("labels.v002.slp"), {
        openVideos: false,
      });

      const instances = labels.labeledFrames.flatMap((lf) => lf.instances);
      expect(instances.length).toBe(9);
      expect(instances.some((inst) => inst instanceof PredictedInstance)).toBe(
        false,
      );
      // Every remaining frame has a user instance, and they match the full read.
      expect(labels.labeledFrames.every((lf) => lf.instances.length > 0)).toBe(
        true,
      );
      expect(userFrames(labels)).toEqual(userFrames(reference));
      // from_predicted links point at predictions that weren't read.
      expect(instances.every((inst) => inst.fromPredicted == null)).toBe(true);
      expect(labels.skeletons.length).toBe(reference.skeletons.length);
      expect(labels.videos.length).toBe(reference.videos.length);

      expect(reads).toContain("points");
      expect(reads).not.toContain("pred_points");
    } finally {
      close();
    }
  });

  it("reads a predictions-only file as no labeled frames, keeping skeleton and videos", async () => {
    const { fake, reads, close } = await makeFakeStreamingFile(
      "centered_pair_predictions.slp",
    );
    try {
      const labels = await readStreaming(fake, { userInstancesOnly: true });
      expect(labels.labeledFrames.length).toBe(0);
      expect(labels.skeletons.length).toBeGreaterThan(0);
      expect(labels.videos.length).toBe(1);
      expect(reads).not.toContain("pred_points");
    } finally {
      close();
    }
  });

  it("skips sessions, whose frame/instance refs no longer line up", async () => {
    const { fake, close } = await makeFakeStreamingFile("multiview.slp");
    try {
      const full = await readStreaming(fake, {});
      expect(full.sessions.length).toBeGreaterThan(0);
      const userOnly = await readStreaming(fake, { userInstancesOnly: true });
      expect(userOnly.sessions.length).toBe(0);
      expect(userOnly.labeledFrames.flatMap((lf) => lf.instances).length).toBe(
        42,
      );
    } finally {
      close();
    }
  });

  it("is off by default: predictions and pred_points are read as before", async () => {
    const { fake, reads, close } =
      await makeFakeStreamingFile("labels.v002.slp");
    try {
      const labels = await readStreaming(fake, {});
      const predicted = labels.labeledFrames
        .flatMap((lf) => lf.instances)
        .filter((inst) => inst instanceof PredictedInstance);
      expect(predicted.length).toBe(12);
      expect(reads).toContain("pred_points");
    } finally {
      close();
    }
  });

  it("can't be combined with lazy", async () => {
    const { fake, close } = await makeFakeStreamingFile("labels.v002.slp");
    try {
      await expect(
        readStreaming(fake, { lazy: true, userInstancesOnly: true }),
      ).rejects.toThrow("userInstancesOnly can't be combined with lazy");
    } finally {
      close();
    }
  });
});
