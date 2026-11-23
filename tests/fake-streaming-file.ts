/**
 * A Node-side `StreamingH5File` over h5wasm, for exercising the streaming
 * reader (`readFromStreamingFile`) in tests; the real one needs a Web Worker.
 *
 * The pose tables (`frames` / `instances` / `points` / `pred_points`) are served
 * as the column records a lazy read produces, which is how the worker returns
 * compound tables. Every other dataset is served straight from h5wasm, and
 * `getKeys(path)` lists a group's children (not just the root's).
 */
import { readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import type { Labels } from "../src/model/labels.js";
import { ready, File as H5File } from "h5wasm/node";

export async function fakeStreamingFile(buf: ArrayBuffer): Promise<{
  fake: StreamingH5File;
  close: () => void;
}> {
  const module = await ready;
  try {
    module.FS.mkdir("/tmp");
  } catch {
    // already exists
  }
  const p = `/tmp/fake_stream_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
  module.FS.writeFile(p, new Uint8Array(buf));
  const h5 = new H5File(p, "r");
  const store = (await readSlpLazy(buf, { openVideos: false }))._lazyDataStore;
  if (!store) throw new Error("readSlpLazy did not produce a lazy store");
  const columns: Record<string, Record<string, unknown[]>> = {
    frames: store.framesData,
    instances: store.instancesData,
    points: store.pointsData,
    pred_points: store.predPointsData,
  };
  const get = (dp: string) => h5.get(dp) as any;
  const unwrap = (attrs: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(attrs ?? {}).map(([k, v]) => [
        k,
        v && typeof v === "object" && "value" in v ? v.value : v,
      ]),
    );
  const fake = {
    keys: () => h5.keys() as string[],
    getKeys: async (dp?: string) =>
      dp ? ((get(dp)?.keys?.() as string[]) ?? []) : (h5.keys() as string[]),
    getAttrs: async (dp: string) => unwrap(get(dp)?.attrs ?? {}),
    getDatasetMeta: async (dp: string) => ({
      shape: get(dp)?.shape ?? [],
      dtype: get(dp)?.dtype ?? "",
    }),
    getDatasetValue: async (dp: string) => {
      if (dp in columns) return { value: columns[dp], shape: [], dtype: "" };
      const d = get(dp);
      return { value: d?.value, shape: d?.shape ?? [], dtype: d?.dtype ?? "" };
    },
  } as unknown as StreamingH5File;
  const close = () => {
    h5.close();
    try {
      module.FS.unlink(p);
    } catch {
      // ignore
    }
  };
  return { fake, close };
}

/** Read `buf` through the streaming reader (eager or lazy) via the fake file. */
export async function readStreamingBytes(
  buf: ArrayBuffer,
  lazy: boolean,
): Promise<Labels> {
  const { fake, close } = await fakeStreamingFile(buf);
  try {
    return await readFromStreamingFile(
      fake,
      "test.slp",
      "test.slp",
      false,
      undefined,
      false,
      lazy,
    );
  } finally {
    close();
  }
}
