/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  LabelImage,
  type LabelImageObjectInfo,
} from "../src/model/label-image.js";
import { Track } from "../src/model/instance.js";
import { SegmentationMask } from "../src/model/mask.js";

/** Helper: create a flat Int32Array label image from a 2D number array. */
function makeLabelData(arr: number[][]): {
  data: Int32Array;
  height: number;
  width: number;
} {
  const height = arr.length;
  const width = arr[0].length;
  const data = new Int32Array(height * width);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      data[r * width + c] = arr[r][c];
    }
  }
  return { data, height, width };
}

/** Helper: create a simple objects map. */
function makeObjects(
  entries: Array<{
    id: number;
    track?: Track | null;
    category?: string;
    name?: string;
  }>,
): Map<number, LabelImageObjectInfo> {
  const map = new Map<number, LabelImageObjectInfo>();
  for (const e of entries) {
    map.set(e.id, {
      track: e.track ?? null,
      category: e.category ?? "",
      name: e.name ?? "",
      instance: null,
    });
  }
  return map;
}

describe("LabelImage", () => {
  describe("constructor", () => {
    it("constructs with required fields", () => {
      const { data, height, width } = makeLabelData([
        [0, 1],
        [2, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.data).toBe(data);
      expect(li.height).toBe(2);
      expect(li.width).toBe(2);
      expect(li.objects.size).toBe(0);
      expect(li.video).toBeNull();
      expect(li.frameIdx).toBeNull();
      expect(li.source).toBe("");
    });

    it("constructs with all optional fields", () => {
      const { data, height, width } = makeLabelData([
        [0, 1],
        [2, 0],
      ]);
      const trackA = new Track("A");
      const objects = makeObjects([
        { id: 1, track: trackA, category: "cell" },
        { id: 2, category: "nucleus" },
      ]);
      const li = new LabelImage({
        data,
        height,
        width,
        objects,
        frameIdx: 5,
        source: "cellpose",
      });
      expect(li.objects.size).toBe(2);
      expect(li.frameIdx).toBe(5);
      expect(li.source).toBe("cellpose");
    });
  });

  describe("nObjects", () => {
    it("returns the size of the objects map", () => {
      const { data, height, width } = makeLabelData([
        [0, 1],
        [2, 0],
      ]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "cell" },
        { id: 3, category: "cell" },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      expect(li.nObjects).toBe(3);
    });
  });

  describe("labelIds", () => {
    it("returns sorted unique non-zero IDs from data", () => {
      const { data, height, width } = makeLabelData([
        [0, 2, 1],
        [3, 0, 2],
        [1, 3, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.labelIds).toEqual([1, 2, 3]);
    });

    it("returns empty array for all-zero data", () => {
      const { data, height, width } = makeLabelData([
        [0, 0],
        [0, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.labelIds).toEqual([]);
    });

    it("handles sparse IDs correctly", () => {
      const { data, height, width } = makeLabelData([
        [0, 3, 0],
        [15, 0, 7],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.labelIds).toEqual([3, 7, 15]);
    });
  });

  describe("tracks", () => {
    it("returns non-null tracks sorted by label ID", () => {
      const trackA = new Track("A");
      const trackB = new Track("B");
      const { data, height, width } = makeLabelData([[1, 2, 3]]);
      const objects = makeObjects([
        { id: 1, track: trackA },
        { id: 2 }, // null track
        { id: 3, track: trackB },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      expect(li.tracks).toEqual([trackA, trackB]);
    });

    it("returns empty array when no tracks", () => {
      const { data, height, width } = makeLabelData([[1, 2]]);
      const objects = makeObjects([{ id: 1 }, { id: 2 }]);
      const li = new LabelImage({ data, height, width, objects });
      expect(li.tracks).toEqual([]);
    });
  });

  describe("categories", () => {
    it("returns unique non-empty category strings", () => {
      const { data, height, width } = makeLabelData([[1, 2, 3]]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "nucleus" },
        { id: 3, category: "cell" }, // duplicate
      ]);
      const li = new LabelImage({ data, height, width, objects });
      const cats = li.categories;
      expect(cats.size).toBe(2);
      expect(cats.has("cell")).toBe(true);
      expect(cats.has("nucleus")).toBe(true);
    });

    it("excludes empty category strings", () => {
      const { data, height, width } = makeLabelData([[1, 2]]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "" },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      expect(li.categories.size).toBe(1);
    });
  });

  describe("isStatic", () => {
    it("is true when frameIdx is null", () => {
      const { data, height, width } = makeLabelData([[0]]);
      const li = new LabelImage({ data, height, width });
      expect(li.isStatic).toBe(true);
    });

    it("is false when frameIdx is set", () => {
      const { data, height, width } = makeLabelData([[0]]);
      const li = new LabelImage({ data, height, width, frameIdx: 0 });
      expect(li.isStatic).toBe(false);
    });
  });

  describe("getObjectMask", () => {
    it("returns binary mask for specific label ID", () => {
      const { data, height, width } = makeLabelData([
        [0, 1, 0],
        [2, 1, 2],
        [0, 0, 0],
      ]);
      const li = new LabelImage({ data, height, width });

      const mask1 = li.getObjectMask(1);
      expect(mask1).toEqual(
        new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0]),
      );

      const mask2 = li.getObjectMask(2);
      expect(mask2).toEqual(
        new Uint8Array([0, 0, 0, 1, 0, 1, 0, 0, 0]),
      );
    });

    it("returns all zeros for non-existent label ID", () => {
      const { data, height, width } = makeLabelData([
        [0, 1],
        [2, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      const mask = li.getObjectMask(99);
      expect(mask).toEqual(new Uint8Array(4));
    });
  });

  describe("getTrackMask", () => {
    it("returns binary mask for a track", () => {
      const trackA = new Track("A");
      const { data, height, width } = makeLabelData([
        [0, 1, 0],
        [2, 0, 1],
      ]);
      const objects = makeObjects([
        { id: 1, track: trackA },
        { id: 2, track: trackA },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      const mask = li.getTrackMask(trackA);
      expect(mask).toEqual(new Uint8Array([0, 1, 0, 1, 0, 1]));
    });

    it("throws for unknown track", () => {
      const { data, height, width } = makeLabelData([[1, 2]]);
      const objects = makeObjects([{ id: 1 }, { id: 2 }]);
      const li = new LabelImage({ data, height, width, objects });
      const unknownTrack = new Track("unknown");
      expect(() => li.getTrackMask(unknownTrack)).toThrow(
        'Track "unknown" not found',
      );
    });
  });

  describe("getCategoryMask", () => {
    it("returns union mask for a category", () => {
      const { data, height, width } = makeLabelData([
        [0, 1, 2],
        [3, 0, 1],
      ]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "nucleus" },
        { id: 3, category: "cell" },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      const mask = li.getCategoryMask("cell");
      // IDs 1 and 3 are "cell"
      expect(mask).toEqual(new Uint8Array([0, 1, 0, 1, 0, 1]));
    });

    it("returns zeros for missing category", () => {
      const { data, height, width } = makeLabelData([
        [1, 2],
        [0, 0],
      ]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "cell" },
      ]);
      const li = new LabelImage({ data, height, width, objects });
      const mask = li.getCategoryMask("nonexistent");
      expect(mask).toEqual(new Uint8Array(4));
    });
  });

  describe("items()", () => {
    it("iterates in sorted label ID order", () => {
      const trackA = new Track("A");
      const trackB = new Track("B");
      const { data, height, width } = makeLabelData([
        [0, 2],
        [1, 0],
      ]);
      const objects = makeObjects([
        { id: 1, track: trackA, category: "cell" },
        { id: 2, track: trackB, category: "nucleus" },
      ]);
      const li = new LabelImage({ data, height, width, objects });

      const results = Array.from(li.items());
      expect(results).toHaveLength(2);

      // First item: label ID 1
      expect(results[0][0]).toBe(trackA);
      expect(results[0][1]).toBe("cell");
      expect(results[0][2]).toEqual(new Uint8Array([0, 0, 1, 0]));

      // Second item: label ID 2
      expect(results[1][0]).toBe(trackB);
      expect(results[1][1]).toBe("nucleus");
      expect(results[1][2]).toEqual(new Uint8Array([0, 1, 0, 0]));
    });

    it("yields nothing for all-zero image", () => {
      const { data, height, width } = makeLabelData([
        [0, 0],
        [0, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(Array.from(li.items())).toEqual([]);
    });

    it("uses default info for labels without objects entry", () => {
      const { data, height, width } = makeLabelData([[1]]);
      const li = new LabelImage({ data, height, width });
      const results = Array.from(li.items());
      expect(results).toHaveLength(1);
      expect(results[0][0]).toBeNull(); // track
      expect(results[0][1]).toBe(""); // category
    });
  });

  describe("fromArray", () => {
    it("creates from Int32Array with auto-created tracks", () => {
      const flat = new Int32Array([0, 1, 2, 0, 3, 0]);
      const li = LabelImage.fromArray(flat, 2, 3);
      expect(li.height).toBe(2);
      expect(li.width).toBe(3);
      expect(li.labelIds).toEqual([1, 2, 3]);
      expect(li.nObjects).toBe(3);
      // Auto-created tracks should have string names
      const tracks = li.tracks;
      expect(tracks).toHaveLength(3);
      expect(tracks[0].name).toBe("1");
      expect(tracks[1].name).toBe("2");
      expect(tracks[2].name).toBe("3");
    });

    it("creates from 2D number array", () => {
      const arr = [
        [0, 1, 0],
        [2, 0, 1],
      ];
      const li = LabelImage.fromArray(arr, 2, 3);
      expect(li.data).toEqual(new Int32Array([0, 1, 0, 2, 0, 1]));
      expect(li.labelIds).toEqual([1, 2]);
    });

    it("accepts Track[] for positional assignment", () => {
      const trackA = new Track("Alpha");
      const trackB = new Track("Beta");
      const flat = new Int32Array([1, 2, 0, 1]);
      const li = LabelImage.fromArray(flat, 2, 2, {
        tracks: [trackA, trackB],
      });
      expect(li.objects.get(1)!.track).toBe(trackA);
      expect(li.objects.get(2)!.track).toBe(trackB);
    });

    it("accepts Map<number, Track> for explicit mapping", () => {
      const trackA = new Track("Alpha");
      const trackB = new Track("Beta");
      const trackMap = new Map<number, Track>();
      trackMap.set(5, trackA);
      trackMap.set(10, trackB);
      const flat = new Int32Array([0, 5, 10, 0]);
      const li = LabelImage.fromArray(flat, 2, 2, { tracks: trackMap });
      expect(li.objects.get(5)!.track).toBe(trackA);
      expect(li.objects.get(10)!.track).toBe(trackB);
    });

    it("accepts string[] categories for positional assignment", () => {
      const flat = new Int32Array([1, 2, 0, 3]);
      const li = LabelImage.fromArray(flat, 2, 2, {
        categories: ["cell", "nucleus", "membrane"],
      });
      expect(li.objects.get(1)!.category).toBe("cell");
      expect(li.objects.get(2)!.category).toBe("nucleus");
      expect(li.objects.get(3)!.category).toBe("membrane");
    });

    it("accepts Map<number, string> categories", () => {
      const catMap = new Map<number, string>();
      catMap.set(1, "cell");
      catMap.set(3, "nucleus");
      const flat = new Int32Array([1, 0, 3, 0]);
      const li = LabelImage.fromArray(flat, 2, 2, { categories: catMap });
      expect(li.objects.get(1)!.category).toBe("cell");
      expect(li.objects.get(3)!.category).toBe("nucleus");
    });

    it("passes through video, frameIdx, source", () => {
      const flat = new Int32Array([0, 1]);
      const li = LabelImage.fromArray(flat, 1, 2, {
        frameIdx: 42,
        source: "stardist",
      });
      expect(li.frameIdx).toBe(42);
      expect(li.source).toBe("stardist");
    });
  });

  describe("fromMasks", () => {
    it("composites masks and preserves metadata", () => {
      const trackA = new Track("A");
      const trackB = new Track("B");
      const mask1 = SegmentationMask.fromArray(
        new Uint8Array([1, 0, 0, 0]),
        2,
        2,
        { track: trackA, category: "cell", name: "obj1" },
      );
      const mask2 = SegmentationMask.fromArray(
        new Uint8Array([0, 0, 1, 1]),
        2,
        2,
        { track: trackB, category: "nucleus", name: "obj2" },
      );
      const li = LabelImage.fromMasks([mask1, mask2], {
        source: "cellpose",
      });

      expect(li.height).toBe(2);
      expect(li.width).toBe(2);
      expect(li.data).toEqual(new Int32Array([1, 0, 2, 2]));
      expect(li.nObjects).toBe(2);
      expect(li.objects.get(1)!.track).toBe(trackA);
      expect(li.objects.get(1)!.category).toBe("cell");
      expect(li.objects.get(1)!.name).toBe("obj1");
      expect(li.objects.get(2)!.track).toBe(trackB);
      expect(li.objects.get(2)!.category).toBe("nucleus");
      expect(li.source).toBe("cellpose");
    });

    it("throws on empty mask list", () => {
      expect(() => LabelImage.fromMasks([])).toThrow(
        "Cannot create LabelImage from empty mask list.",
      );
    });

    it("throws on mismatched mask shapes", () => {
      const mask1 = SegmentationMask.fromArray(
        new Uint8Array([1, 0, 0, 0]),
        2,
        2,
      );
      const mask2 = SegmentationMask.fromArray(
        new Uint8Array([1, 0, 0, 0, 0, 0]),
        3,
        2,
      );
      expect(() => LabelImage.fromMasks([mask1, mask2])).toThrow(
        "All masks must have the same shape",
      );
    });
  });

  describe("toMasks", () => {
    it("decomposes into SegmentationMask array", () => {
      const trackA = new Track("A");
      const { data, height, width } = makeLabelData([
        [0, 1],
        [2, 0],
      ]);
      const objects = makeObjects([
        { id: 1, track: trackA, category: "cell", name: "obj1" },
        { id: 2, category: "nucleus", name: "obj2" },
      ]);
      const li = new LabelImage({
        data,
        height,
        width,
        objects,
        source: "test",
      });

      const masks = li.toMasks();
      expect(masks).toHaveLength(2);

      // Mask for label 1
      expect(masks[0].data).toEqual(new Uint8Array([0, 1, 0, 0]));
      expect(masks[0].track).toBe(trackA);
      expect(masks[0].category).toBe("cell");
      expect(masks[0].name).toBe("obj1");
      expect(masks[0].source).toBe("test");

      // Mask for label 2
      expect(masks[1].data).toEqual(new Uint8Array([0, 0, 1, 0]));
      expect(masks[1].track).toBeNull();
      expect(masks[1].category).toBe("nucleus");
      expect(masks[1].name).toBe("obj2");
    });

    it("returns empty array for all-zero image", () => {
      const { data, height, width } = makeLabelData([
        [0, 0],
        [0, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.toMasks()).toEqual([]);
    });
  });

  describe("round-trip", () => {
    it("fromMasks -> toMasks preserves mask data", () => {
      const mask1 = SegmentationMask.fromArray(
        new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0]),
        3,
        3,
        { category: "a", name: "m1" },
      );
      const mask2 = SegmentationMask.fromArray(
        new Uint8Array([0, 0, 0, 0, 1, 1, 0, 0, 0]),
        3,
        3,
        { category: "b", name: "m2" },
      );
      const mask3 = SegmentationMask.fromArray(
        new Uint8Array([0, 0, 0, 0, 0, 0, 1, 1, 1]),
        3,
        3,
        { category: "a", name: "m3" },
      );

      const li = LabelImage.fromMasks([mask1, mask2, mask3]);
      const recovered = li.toMasks();

      expect(recovered).toHaveLength(3);
      expect(recovered[0].data).toEqual(mask1.data);
      expect(recovered[1].data).toEqual(mask2.data);
      expect(recovered[2].data).toEqual(mask3.data);
      expect(recovered[0].category).toBe("a");
      expect(recovered[1].category).toBe("b");
      expect(recovered[2].category).toBe("a");
      expect(recovered[0].name).toBe("m1");
      expect(recovered[1].name).toBe("m2");
      expect(recovered[2].name).toBe("m3");
    });
  });

  describe("edge cases", () => {
    it("all-zero image has nObjects=0 and empty labelIds", () => {
      const { data, height, width } = makeLabelData([
        [0, 0, 0],
        [0, 0, 0],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.nObjects).toBe(0);
      expect(li.labelIds).toEqual([]);
      expect(li.tracks).toEqual([]);
      expect(li.categories.size).toBe(0);
      expect(Array.from(li.items())).toEqual([]);
    });

    it("single object works correctly", () => {
      const { data, height, width } = makeLabelData([
        [0, 1],
        [1, 0],
      ]);
      const track = new Track("only");
      const objects = makeObjects([{ id: 1, track, category: "cell" }]);
      const li = new LabelImage({ data, height, width, objects });
      expect(li.nObjects).toBe(1);
      expect(li.labelIds).toEqual([1]);
      expect(li.tracks).toEqual([track]);
      expect(li.getObjectMask(1)).toEqual(
        new Uint8Array([0, 1, 1, 0]),
      );
    });

    it("sparse IDs (3, 7, 15) sort correctly", () => {
      const { data, height, width } = makeLabelData([
        [0, 15, 3],
        [7, 0, 15],
      ]);
      const li = new LabelImage({ data, height, width });
      expect(li.labelIds).toEqual([3, 7, 15]);
    });

    it("fromArray with sparse IDs auto-creates tracks", () => {
      const flat = new Int32Array([0, 3, 7, 0, 15, 0]);
      const li = LabelImage.fromArray(flat, 2, 3);
      expect(li.labelIds).toEqual([3, 7, 15]);
      const tracks = li.tracks;
      expect(tracks).toHaveLength(3);
      expect(tracks[0].name).toBe("3");
      expect(tracks[1].name).toBe("7");
      expect(tracks[2].name).toBe("15");
    });
  });
});
