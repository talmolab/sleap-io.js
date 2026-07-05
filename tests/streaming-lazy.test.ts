/**
 * Lazy mode for the streaming SLP reader (`readSlpStreaming({ lazy: true })`).
 *
 * `readSlpStreaming` is Worker-gated and unreachable from the all-Node test
 * suite, so we exercise the lazy branch through the exported orchestrator
 * `readFromStreamingFile`, driven by a fake `StreamingH5File`. The fake serves:
 *   - the compound pose tables (frames/instances/points/pred_points) as the
 *     already-columnar `{ field: array }` objects a real `readSlpLazy` store
 *     holds for the same fixture (streaming's `normalizeStructData` passes a
 *     column object straight through), and
 *   - everything else (metadata attrs + the JSON datasets) from a plain
 *     `h5wasm/node` open of the same fixture.
 *
 * Assertions:
 *   - the eager streaming branch through the fake matches `readSlp` (fake is
 *     faithful), and
 *   - the lazy streaming branch, once materialized, is frame-for-frame equal to
 *     the eager streaming branch — the invariant the new `lazy` option must hold.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const slpPath = (name: string) => path.join(fixtureRoot, "slp", name);

/** Unwrap h5wasm/node attr entries (`{ value }`) to match the streaming
 * worker's `getAttrs`, which returns bare attribute values. */
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

/**
 * Build a fake `StreamingH5File` for a fixture: compound tables from a real
 * `readSlpLazy` store, all other datasets/attrs from `h5wasm/node`.
 */
async function makeFakeStreamingFile(fixture: string): Promise<{
  fake: StreamingH5File;
  close: () => void;
}> {
  const module = await ready;
  try {
    module.FS.mkdir("/tmp");
  } catch {
    // already exists
  }
  const p = `/tmp/streaming_lazy_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}.slp`;
  module.FS.writeFile(p, readFileSync(slpPath(fixture)));
  const h5 = new H5File(p, "r");

  // Real, normalized columns for the compound pose tables (same fixture).
  const store = (await readSlpLazy(slpPath(fixture), { openVideos: false }))
    ._lazyDataStore;
  if (!store) throw new Error("readSlpLazy did not produce a lazy store");
  const columns: Record<string, Record<string, unknown[]>> = {
    frames: store.framesData,
    instances: store.instancesData,
    points: store.pointsData,
    pred_points: store.predPointsData,
  };

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
      if (dp in columns) {
        return { value: columns[dp], shape: [], dtype: "" };
      }
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

/** Drive the exported streaming orchestrator directly (no Worker). */
function readStreaming(fake: StreamingH5File, lazy: boolean) {
  return readFromStreamingFile(
    fake,
    "test.slp",
    "test.slp",
    false,
    undefined,
    false,
    lazy,
  );
}

const FIXTURES = [
  "centered_pair_predictions.slp", // predicted instances
  "predictions_1.2.7_provenance_and_tracking.slp", // predicted + multiple tracks
];

describe("Streaming lazy mode (readSlpStreaming lazy option)", () => {
  it("readFromStreamingFile with lazy=true returns a lazy Labels", async () => {
    const { fake, close } = await makeFakeStreamingFile(FIXTURES[0]);
    try {
      const lazy = await readStreaming(fake, true);
      expect(lazy.isLazy).toBe(true);
      expect(lazy._lazyFrameList).not.toBeNull();
      expect(lazy._lazyDataStore).not.toBeNull();
      expect(lazy.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it("lazy mode defers materialization (metadata available, frames not built)", async () => {
    const { fake, close } = await makeFakeStreamingFile(FIXTURES[0]);
    try {
      const lazy = await readStreaming(fake, true);
      expect(lazy._lazyFrameList!.materializedCount).toBe(0);
      // metadata is available without materializing any frame
      expect(lazy.skeletons.length).toBeGreaterThan(0);
      expect(lazy.skeletons[0].nodeNames.length).toBeGreaterThan(0);
      // a single frame access materializes exactly one frame
      const frame = lazy._lazyFrameList!.at(0);
      expect(frame).toBeDefined();
      expect(lazy._lazyFrameList!.materializedCount).toBe(1);
    } finally {
      close();
    }
  });

  for (const fixture of FIXTURES) {
    it(`eager streaming branch matches readSlp — ${fixture}`, async () => {
      const { fake, close } = await makeFakeStreamingFile(fixture);
      try {
        const eager = await readStreaming(fake, false);
        const oracle = await readSlp(slpPath(fixture), { openVideos: false });
        expect(eager.isLazy).toBe(false);
        expect(eager.labeledFrames.length).toBe(oracle.labeledFrames.length);
        expect(eager.skeletons.length).toBe(oracle.skeletons.length);
        expect(eager.tracks.length).toBe(oracle.tracks.length);
        // spot-check the first few frames' instance point data
        for (let i = 0; i < Math.min(3, oracle.labeledFrames.length); i++) {
          const e = eager.labeledFrames[i];
          const o = oracle.labeledFrames[i];
          expect(e.frameIdx).toBe(o.frameIdx);
          expect(e.instances.length).toBe(o.instances.length);
          for (let j = 0; j < o.instances.length; j++) {
            expect(e.instances[j].numpy()).toEqual(o.instances[j].numpy());
          }
        }
      } finally {
        close();
      }
    });

    it(`lazy streaming ≡ eager streaming, frame-for-frame — ${fixture}`, async () => {
      const { fake, close } = await makeFakeStreamingFile(fixture);
      try {
        const eager = await readStreaming(fake, false);
        const lazy = await readStreaming(fake, true);

        expect(lazy.length).toBe(eager.labeledFrames.length);

        lazy.materialize();
        expect(lazy.isLazy).toBe(false);
        expect(lazy.labeledFrames.length).toBe(eager.labeledFrames.length);
        expect(lazy.videos.length).toBe(eager.videos.length);
        expect(lazy.skeletons.length).toBe(eager.skeletons.length);
        expect(lazy.tracks.length).toBe(eager.tracks.length);

        for (let i = 0; i < eager.labeledFrames.length; i++) {
          const e = eager.labeledFrames[i];
          const l = lazy.labeledFrames[i];
          expect(l.frameIdx).toBe(e.frameIdx);
          expect(l.instances.length).toBe(e.instances.length);
          for (let j = 0; j < e.instances.length; j++) {
            expect(l.instances[j].numpy()).toEqual(e.instances[j].numpy());
            expect(l.instances[j].track?.name ?? null).toBe(
              e.instances[j].track?.name ?? null,
            );
          }
        }
      } finally {
        close();
      }
    });
  }
});
