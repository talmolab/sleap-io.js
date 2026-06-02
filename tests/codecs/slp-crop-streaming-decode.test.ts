/**
 * REGRESSION: `readVideoCropsStreaming` must decode the `/video_crops` payload
 * for every form h5wasm surfaces it as. The streaming reader previously flattened
 * a raw `Uint8Array` via `Array.from(raw)[0]`, extracting a SINGLE BYTE (e.g. 91
 * for '[') instead of decoding the whole JSON string. That made the subsequent
 * `instanceof Uint8Array` check fail, `String(byteNumber)` produced unparseable
 * JSON, and the catch silently returned an EMPTY map — dropping all crops in
 * streaming mode.
 *
 * h5wasm surfaces the vlen-string payload as: (a) a plain string, (b) a length-1
 * array of strings (the vlen form), or (c) raw bytes (Uint8Array). All three must
 * parse to the same crop map, matching the non-streaming `readVideoCrops`.
 */
import { describe, it, expect } from "../bun-test";
import { readVideoCropsStreaming } from "../../src/codecs/slp/read-streaming.js";

const CROPS = [{ video: 0, crop: [64, 96, 320, 288], fill: 128 }];
const JSON_PAYLOAD = JSON.stringify(CROPS);

/** A minimal StreamingH5File stand-in returning `/video_crops` as `value`. */
function mockFile(value: unknown): any {
  return {
    keys: () => ["video_crops"],
    getDatasetValue: async (_path: string) => ({ value, shape: [], dtype: "" }),
  };
}

describe("readVideoCropsStreaming — h5wasm payload forms", () => {
  it("decodes a raw Uint8Array (the regressed form)", async () => {
    const bytes = new TextEncoder().encode(JSON_PAYLOAD);
    const map = await readVideoCropsStreaming(mockFile(bytes));
    expect(map.size).toBe(1);
    expect(map.get(0)).toEqual({ crop: [64, 96, 320, 288], fill: 128 });
  });

  it("decodes a plain string payload", async () => {
    const map = await readVideoCropsStreaming(mockFile(JSON_PAYLOAD));
    expect(map.get(0)).toEqual({ crop: [64, 96, 320, 288], fill: 128 });
  });

  it("decodes a length-1 array of strings (vlen form)", async () => {
    const map = await readVideoCropsStreaming(mockFile([JSON_PAYLOAD]));
    expect(map.get(0)).toEqual({ crop: [64, 96, 320, 288], fill: 128 });
  });

  it("decodes a length-1 array wrapping raw bytes", async () => {
    const bytes = new TextEncoder().encode(JSON_PAYLOAD);
    const map = await readVideoCropsStreaming(mockFile([bytes]));
    expect(map.get(0)).toEqual({ crop: [64, 96, 320, 288], fill: 128 });
  });

  it("returns an empty map when /video_crops is absent", async () => {
    const file: any = { keys: () => [], getDatasetValue: async () => ({ value: null }) };
    const map = await readVideoCropsStreaming(file);
    expect(map.size).toBe(0);
  });

  it("preserves an array (per-channel) fill across byte decoding", async () => {
    const crops = [{ video: 1, crop: [0, 0, 10, 10], fill: [10, 20, 30] }];
    const bytes = new TextEncoder().encode(JSON.stringify(crops));
    const map = await readVideoCropsStreaming(mockFile(bytes));
    expect(map.get(1)).toEqual({ crop: [0, 0, 10, 10], fill: [10, 20, 30] });
  });
});
