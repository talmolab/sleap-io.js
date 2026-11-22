/**
 * Helpers for the SLP format 3.0 tests: fixture paths, and a stand-in for the
 * streaming reader's worker file over a real fixture. Not a test file itself.
 */
import { ready, File as H5File } from "h5wasm/node";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";

const slpDir = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
);

/** Path of a fixture under tests/data/slp. */
export const slpPath = (name: string) => path.join(slpDir, name);

/** Bytes of a fixture under tests/data/slp. */
export const slpBytes = (name: string) =>
  new Uint8Array(readFileSync(slpPath(name)));

/**
 * A `StreamingH5File` over a real fixture, read with h5wasm/node.
 * `readSlpStreaming` needs a Web Worker and can't run in this suite, so the
 * streaming reader is driven through `readFromStreamingFile`. Attributes come
 * back wrapped as `{ value }`, as the worker's `getAttrs` returns them.
 * `compound` supplies the already-columnar pose tables of a 2.x file, which
 * the worker reads with a fast path this stand-in doesn't have.
 */
export async function streamingFile(
  name: string,
  compound: Record<string, unknown> = {},
): Promise<{ file: StreamingH5File; close: () => void }> {
  await ready;
  const h5 = new H5File(path.isAbsolute(name) ? name : slpPath(name), "r");
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm entities
  const get = (p: string) => h5.get(p) as any;
  const file = {
    keys: () => h5.keys() as string[],
    getKeys: async (p: string) => {
      const node = get(p);
      if (!node || node.type !== "Group") {
        throw new Error(`Not a group: ${p}`);
      }
      return node.keys() as string[];
    },
    getAttrs: async (p: string) => {
      const node = get(p);
      if (!node) throw new Error(`Path not found: ${p}`);
      const out: Record<string, unknown> = {};
      for (const [key, attr] of Object.entries(node.attrs ?? {})) {
        out[key] = { value: (attr as { value: unknown }).value };
      }
      return out;
    },
    getDatasetMeta: async (p: string) => {
      const d = get(p);
      if (!d) throw new Error(`Dataset not found: ${p}`);
      // A group has no shape, as the worker reports it.
      return { shape: d.shape, dtype: d.dtype, metadata: d.metadata };
    },
    getDatasetValue: async (p: string) => {
      if (p in compound) return { value: compound[p], shape: [], dtype: "" };
      const d = get(p);
      return { value: d?.value, shape: d?.shape ?? [], dtype: d?.dtype ?? "" };
    },
  } as unknown as StreamingH5File;
  return { file, close: () => h5.close() };
}
