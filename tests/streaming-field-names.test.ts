/**
 * Regression tests for the streaming reader's compound-dtype field-name
 * extraction (issues #113 / PR #114).
 *
 * h5wasm 0.10.x (bumped in PR #111) represents compound dataset dtypes as an
 * array of [name, type] pairs, e.g. [["frame_id", "<Q"], ["video", "<I"], ...].
 * `getFieldNamesFromMeta` previously only handled the legacy string-repr and
 * object-with-`compound_type` shapes, falling through to `[]` on the array
 * format. That silently dropped every frame/instance/point when loading
 * Python sleap-io / PyQt SLP files via the Worker path (0 labeled frames).
 *
 * The streaming path is browser/Worker-gated (loadSlp routes to readSlp under
 * Node), so it is unreachable from the all-Node suite. This unit test imports
 * the (test-only exported) function directly to lock in the fix and guard the
 * pre-existing branches against regression. The array-of-pairs fixtures below
 * are the exact shapes h5wasm 0.10.x emits for the repo's Python .slp fixtures.
 */
import { describe, it, expect } from "./bun-test";
import { getFieldNamesFromMeta } from "../src/codecs/slp/read-streaming.js";

describe("getFieldNamesFromMeta — h5wasm 0.10.x array-of-pairs compound dtype (#113/#114)", () => {
  it("extracts field names from array-of-[name,type] pairs (points)", () => {
    const dtype = [
      ["x", "<d"],
      ["y", "<d"],
      ["visible", "unknown"],
      ["complete", "unknown"],
    ] as unknown as string;
    expect(getFieldNamesFromMeta({ shape: [10, 4], dtype })).toEqual([
      "x",
      "y",
      "visible",
      "complete",
    ]);
  });

  it("handles the frames compound dtype", () => {
    const dtype = [
      ["frame_id", "<Q"],
      ["video", "<I"],
      ["frame_idx", "<Q"],
      ["instance_id_start", "<Q"],
      ["instance_id_end", "<Q"],
    ] as unknown as string;
    expect(getFieldNamesFromMeta({ shape: [5, 5], dtype })).toEqual([
      "frame_id",
      "video",
      "frame_idx",
      "instance_id_start",
      "instance_id_end",
    ]);
  });

  it("still handles the legacy string-repr dtype", () => {
    expect(
      getFieldNamesFromMeta({
        shape: [1, 4],
        dtype:
          "{'names':['x','y','visible','complete'],'formats':['<d','<d','|b1','|b1']}",
      })
    ).toEqual(["x", "y", "visible", "complete"]);
  });

  it("still handles the object compound_type.members shape", () => {
    const dtype = {
      compound_type: { members: [{ name: "a" }, { name: "b" }] },
    } as unknown as string;
    expect(getFieldNamesFromMeta({ shape: [1, 2], dtype })).toEqual(["a", "b"]);
  });

  it("returns [] for an unrecognized dtype", () => {
    expect(getFieldNamesFromMeta({ shape: [1], dtype: "<i" })).toEqual([]);
  });
});
