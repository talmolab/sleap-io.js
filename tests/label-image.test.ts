/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  LabelImage,
  UserLabelImage,
  PredictedLabelImage,
  type LabelImageObjectInfo,
  normalizeLabelIds,
} from "../src/model/label-image.js";
import { Track } from "../src/model/instance.js";
import { SegmentationMask, PredictedSegmentationMask } from "../src/model/mask.js";

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
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({
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
      const li = new UserLabelImage({ data, height, width, objects });
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
      const li = new UserLabelImage({ data, height, width });
      expect(li.labelIds).toEqual([1, 2, 3]);
    });

    it("returns empty array for all-zero data", () => {
      const { data, height, width } = makeLabelData([
        [0, 0],
        [0, 0],
      ]);
      const li = new UserLabelImage({ data, height, width });
      expect(li.labelIds).toEqual([]);
    });

    it("handles sparse IDs correctly", () => {
      const { data, height, width } = makeLabelData([
        [0, 3, 0],
        [15, 0, 7],
      ]);
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({ data, height, width, objects });
      expect(li.tracks).toEqual([trackA, trackB]);
    });

    it("returns empty array when no tracks", () => {
      const { data, height, width } = makeLabelData([[1, 2]]);
      const objects = makeObjects([{ id: 1 }, { id: 2 }]);
      const li = new UserLabelImage({ data, height, width, objects });
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
      const li = new UserLabelImage({ data, height, width, objects });
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
      const li = new UserLabelImage({ data, height, width, objects });
      expect(li.categories.size).toBe(1);
    });
  });

  describe("isStatic", () => {
    it("is true when frameIdx is null", () => {
      const { data, height, width } = makeLabelData([[0]]);
      const li = new UserLabelImage({ data, height, width });
      expect(li.isStatic).toBe(true);
    });

    it("is false when frameIdx is set", () => {
      const { data, height, width } = makeLabelData([[0]]);
      const li = new UserLabelImage({ data, height, width, frameIdx: 0 });
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
      const li = new UserLabelImage({ data, height, width });

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
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({ data, height, width, objects });
      const mask = li.getTrackMask(trackA);
      expect(mask).toEqual(new Uint8Array([0, 1, 0, 1, 0, 1]));
    });

    it("throws for unknown track", () => {
      const { data, height, width } = makeLabelData([[1, 2]]);
      const objects = makeObjects([{ id: 1 }, { id: 2 }]);
      const li = new UserLabelImage({ data, height, width, objects });
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
      const li = new UserLabelImage({ data, height, width, objects });
      const mask = li.getCategoryMask("cell");
      // IDs 1 and 3 are "cell"
      expect(mask).toEqual(new Uint8Array([0, 1, 0, 1, 0, 1]));
    });

    it("throws for missing category", () => {
      const { data, height, width } = makeLabelData([
        [1, 2],
        [0, 0],
      ]);
      const objects = makeObjects([
        { id: 1, category: "cell" },
        { id: 2, category: "cell" },
      ]);
      const li = new UserLabelImage({ data, height, width, objects });
      expect(() => li.getCategoryMask("nonexistent")).toThrow(
        'Category "nonexistent" not found in this LabelImage.',
      );
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
      const li = new UserLabelImage({ data, height, width, objects });

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
      const li = new UserLabelImage({ data, height, width });
      expect(Array.from(li.items())).toEqual([]);
    });

    it("uses default info for labels without objects entry", () => {
      const { data, height, width } = makeLabelData([[1]]);
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({
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
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({ data, height, width });
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
      const li = new UserLabelImage({ data, height, width, objects });
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
      const li = new UserLabelImage({ data, height, width });
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

describe("LabelImage abstract base and subclasses", () => {
  it("LabelImage cannot be instantiated directly", () => {
    const data = new Int32Array(4);
    expect(() => new (LabelImage as any)({ data, height: 2, width: 2 })).toThrow(TypeError);
  });

  it("UserLabelImage isPredicted is false", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const li = new UserLabelImage({ data, height, width });
    expect(li.isPredicted).toBe(false);
    expect(li).toBeInstanceOf(UserLabelImage);
  });

  it("PredictedLabelImage has score, scoreMap, isPredicted", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const sm = new Float32Array(4).fill(0.5);
    const li = new PredictedLabelImage({
      data, height, width, score: 0.88, scoreMap: sm,
      scoreMapScale: [2, 2], scoreMapOffset: [1, 1],
    });
    expect(li.isPredicted).toBe(true);
    expect(li.score).toBe(0.88);
    expect(li.scoreMap).toBe(sm);
    expect(li.scoreMapScale).toEqual([2, 2]);
    expect(li.scoreMapOffset).toEqual([1, 1]);
  });

  it("PredictedLabelImage defaults scoreMap to null", () => {
    const { data, height, width } = makeLabelData([[0]]);
    const li = new PredictedLabelImage({ data, height, width, score: 0.5 });
    expect(li.scoreMap).toBeNull();
    expect(li.scoreMapScale).toEqual([1, 1]);
    expect(li.scoreMapOffset).toEqual([0, 0]);
  });
});

describe("LabelImage.fromStack", () => {
  it("creates label images from 2D array stack", () => {
    const frame1 = [[1, 0], [0, 2]];
    const frame2 = [[0, 1], [2, 0]];
    const result = LabelImage.fromStack({ data: [frame1, frame2] });
    expect(result).toHaveLength(2);
    expect(result[0].frameIdx).toBe(0);
    expect(result[1].frameIdx).toBe(1);
    expect(result[0].height).toBe(2);
    expect(result[0].width).toBe(2);
  });

  it("createTracks auto-creates shared Track objects", () => {
    const frame1 = [[1, 0], [0, 2]];
    const frame2 = [[0, 1], [2, 0]];
    const result = LabelImage.fromStack({ data: [frame1, frame2], createTracks: true });
    // Both frames should share the same Track references
    const tracks1 = result[0].tracks;
    const tracks2 = result[1].tracks;
    expect(tracks1).toHaveLength(2);
    expect(tracks2).toHaveLength(2);
    expect(tracks1[0]).toBe(tracks2[0]); // Same Track object reference
    expect(tracks1[1]).toBe(tracks2[1]);
  });

  it("accepts custom categories as Map", () => {
    const frame = [[1, 2], [0, 0]];
    const cats = new Map<number, string>([[1, "cell"], [2, "nucleus"]]);
    const result = LabelImage.fromStack({ data: [frame], categories: cats });
    expect(result[0].objects.get(1)?.category).toBe("cell");
    expect(result[0].objects.get(2)?.category).toBe("nucleus");
  });

  it("accepts custom categories as Array (1-indexed)", () => {
    const frame = [[1, 2], [0, 0]];
    const result = LabelImage.fromStack({ data: [frame], categories: ["cell", "nucleus"] });
    expect(result[0].objects.get(1)?.category).toBe("cell");
    expect(result[0].objects.get(2)?.category).toBe("nucleus");
  });

  it("uses custom frameIdx", () => {
    const result = LabelImage.fromStack({
      data: [[[1]], [[2]]],
      frameIdx: [10, 20],
    });
    expect(result[0].frameIdx).toBe(10);
    expect(result[1].frameIdx).toBe(20);
  });

  it("returns empty array for empty data", () => {
    expect(LabelImage.fromStack({ data: [] })).toEqual([]);
  });
});

describe("LabelImage scale/offset", () => {
  it("default scale/offset is identity", () => {
    const { data, height, width } = makeLabelData([[1]]);
    const li = new UserLabelImage({ data, height, width });
    expect(li.scale).toEqual([1, 1]);
    expect(li.offset).toEqual([0, 0]);
    expect(li.hasSpatialTransform).toBe(false);
  });

  it("hasSpatialTransform detects non-identity", () => {
    const { data, height, width } = makeLabelData([[1]]);
    const li = new UserLabelImage({ data, height, width, scale: [2, 2] });
    expect(li.hasSpatialTransform).toBe(true);
  });

  it("imageExtent accounts for scale", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 1]]);
    const li = new UserLabelImage({ data, height, width, scale: [2, 2] });
    expect(li.imageExtent).toEqual({ height: 1, width: 1 });
  });

  it("resampled returns identity scale/offset", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const li = new UserLabelImage({ data, height, width, scale: [2, 2], offset: [5, 5] });
    const resampled = li.resampled(1, 1);
    expect(resampled.scale).toEqual([1, 1]);
    expect(resampled.offset).toEqual([0, 0]);
    expect(resampled.height).toBe(1);
    expect(resampled.width).toBe(1);
    expect(resampled).toBeInstanceOf(UserLabelImage);
  });

  it("resampled preserves PredictedLabelImage", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const sm = new Float32Array(4).fill(0.5);
    const li = new PredictedLabelImage({ data, height, width, score: 0.9, scoreMap: sm });
    const resampled = li.resampled(1, 1);
    expect(resampled).toBeInstanceOf(PredictedLabelImage);
    const pli = resampled as PredictedLabelImage;
    expect(pli.score).toBe(0.9);
    expect(pli.scoreMap).not.toBeNull();
    expect(pli.scoreMap!.length).toBe(1); // 1*1
  });

  it("fromMasks validates consistent scale/offset", () => {
    const m1 = SegmentationMask.fromArray(new Uint8Array([1, 0, 0, 0]), 2, 2, { scale: [2, 2] });
    const m2 = SegmentationMask.fromArray(new Uint8Array([0, 1, 0, 0]), 2, 2, { scale: [3, 3] });
    expect(() => LabelImage.fromMasks([m1, m2])).toThrow("same scale");
  });

  it("toMasks propagates scale/offset", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const li = new UserLabelImage({ data, height, width, scale: [2, 2], offset: [5, 5] });
    const masks = li.toMasks();
    for (const mask of masks) {
      expect(mask.scale).toEqual([2, 2]);
      expect(mask.offset).toEqual([5, 5]);
    }
  });

  it("toMasks creates PredictedSegmentationMask from PredictedLabelImage", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const li = new PredictedLabelImage({ data, height, width, score: 0.9 });
    const masks = li.toMasks();
    expect(masks).toHaveLength(2);
    for (const mask of masks) {
      expect(mask).toBeInstanceOf(PredictedSegmentationMask);
      expect(mask.isPredicted).toBe(true);
      expect((mask as PredictedSegmentationMask).score).toBe(0.9);
    }
  });

  it("toMasks uses per-object score when available", () => {
    const { data, height, width } = makeLabelData([[1, 0], [0, 2]]);
    const objects = new Map<number, LabelImageObjectInfo>([
      [1, { track: null, category: "", name: "", instance: null, score: 0.7 }],
      [2, { track: null, category: "", name: "", instance: null, score: 0.3 }],
    ]);
    const li = new PredictedLabelImage({ data, height, width, objects, score: 0.5 });
    const masks = li.toMasks();
    expect((masks[0] as PredictedSegmentationMask).score).toBe(0.7);
    expect((masks[1] as PredictedSegmentationMask).score).toBe(0.3);
  });

  it("scale must be positive", () => {
    const { data, height, width } = makeLabelData([[0]]);
    expect(() => new UserLabelImage({ data, height, width, scale: [-1, 1] })).toThrow("Scale must be positive");
  });
});

// --- fromBinaryMasks tests ---

describe("LabelImage.fromBinaryMasks", () => {
  it("creates from a single 2D mask", () => {
    const li = LabelImage.fromBinaryMasks([
      [1, 0],
      [0, 1],
    ]);
    expect(li).toBeInstanceOf(UserLabelImage);
    expect(li.height).toBe(2);
    expect(li.width).toBe(2);
    expect(li.labelIds).toEqual([1]);
    expect(li.data[0]).toBe(1); // top-left
    expect(li.data[1]).toBe(0);
    expect(li.data[2]).toBe(0);
    expect(li.data[3]).toBe(1); // bottom-right
  });

  it("creates from multiple 2D masks (number[][][])", () => {
    const li = LabelImage.fromBinaryMasks([
      [
        [1, 0],
        [0, 0],
      ],
      [
        [0, 1],
        [1, 0],
      ],
    ]);
    expect(li.labelIds).toEqual([1, 2]);
    expect(li.data[0]).toBe(1);
    expect(li.data[1]).toBe(2);
    expect(li.data[2]).toBe(2);
    expect(li.data[3]).toBe(0);
    expect(li.nObjects).toBe(2);
  });

  it("creates from a list of Uint8Array masks", () => {
    const m1 = new Uint8Array([1, 0, 0, 0]);
    const m2 = new Uint8Array([0, 0, 1, 1]);
    const li = LabelImage.fromBinaryMasks([m1, m2], {
      height: 2,
      width: 2,
    });
    expect(li.labelIds).toEqual([1, 2]);
    expect(li.data[0]).toBe(1);
    expect(li.data[2]).toBe(2);
    expect(li.data[3]).toBe(2);
  });

  it("last mask wins on overlap", () => {
    const li = LabelImage.fromBinaryMasks([
      [
        [1, 1],
        [0, 0],
      ],
      [
        [1, 0],
        [0, 0],
      ],
    ]);
    // Pixel (0,0) is set by both masks; mask 2 (labelId=2) wins
    expect(li.data[0]).toBe(2);
    expect(li.data[1]).toBe(1);
  });

  it("assigns tracks from options", () => {
    const tA = new Track("A");
    const tB = new Track("B");
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { tracks: [tA, tB] },
    );
    expect(li.objects.get(1)!.track).toBe(tA);
    expect(li.objects.get(2)!.track).toBe(tB);
  });

  it("auto-creates tracks with createTracks", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { createTracks: true },
    );
    const tracks = li.tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toBe("1");
    expect(tracks[1].name).toBe("2");
  });

  it("auto-creates tracks named by custom labelIds", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { createTracks: true, labelIds: [5, 10] },
    );
    const tracks = li.tracks;
    expect(tracks[0].name).toBe("5");
    expect(tracks[1].name).toBe("10");
  });

  it("assigns categories", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { categories: ["cell", "nucleus"] },
    );
    expect(li.objects.get(1)!.category).toBe("cell");
    expect(li.objects.get(2)!.category).toBe("nucleus");
  });

  it("assigns names", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { names: ["obj1", "obj2"] },
    );
    expect(li.objects.get(1)!.name).toBe("obj1");
    expect(li.objects.get(2)!.name).toBe("obj2");
  });

  it("assigns scores", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { scores: [0.9, 0.8] },
    );
    expect(li.objects.get(1)!.score).toBe(0.9);
    expect(li.objects.get(2)!.score).toBe(0.8);
  });

  it("uses custom labelIds for pixel values", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { labelIds: [5, 10] },
    );
    expect(li.labelIds).toEqual([5, 10]);
    expect(li.data[0]).toBe(5);
    expect(li.data[1]).toBe(10);
    expect(li.objects.has(5)).toBe(true);
    expect(li.objects.has(10)).toBe(true);
  });

  it("passes through video, frameIdx, source", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [1, 0],
        [0, 1],
      ],
      { frameIdx: 42, source: "test.png" },
    );
    expect(li.frameIdx).toBe(42);
    expect(li.source).toBe("test.png");
  });

  it("throws on empty mask list", () => {
    expect(() =>
      LabelImage.fromBinaryMasks([] as number[][][]),
    ).toThrow("empty mask list");
  });

  it("throws on mismatched mask dimensions", () => {
    expect(() =>
      LabelImage.fromBinaryMasks([
        [
          [1, 0],
          [0, 0],
        ],
        [[1, 0, 0]],
      ]),
    ).toThrow("shape");
  });

  it("throws on mismatched tracks length", () => {
    expect(() =>
      LabelImage.fromBinaryMasks(
        [
          [
            [1, 0],
            [0, 0],
          ],
        ],
        { tracks: [new Track("A"), new Track("B")] },
      ),
    ).toThrow("tracks length");
  });

  it("throws on mismatched categories length", () => {
    expect(() =>
      LabelImage.fromBinaryMasks(
        [
          [
            [1, 0],
            [0, 0],
          ],
        ],
        { categories: ["a", "b"] },
      ),
    ).toThrow("categories length");
  });

  it("throws on non-positive labelIds", () => {
    expect(() =>
      LabelImage.fromBinaryMasks(
        [
          [
            [1, 0],
            [0, 0],
          ],
        ],
        { labelIds: [0] },
      ),
    ).toThrow("positive");
  });

  it("throws on duplicate labelIds", () => {
    expect(() =>
      LabelImage.fromBinaryMasks(
        [
          [
            [1, 0],
            [0, 0],
          ],
          [
            [0, 1],
            [0, 0],
          ],
        ],
        { labelIds: [3, 3] },
      ),
    ).toThrow("Duplicate");
  });

  it("null tracks by default", () => {
    const li = LabelImage.fromBinaryMasks([
      [
        [1, 0],
        [0, 0],
      ],
    ]);
    expect(li.objects.get(1)!.track).toBeNull();
  });

  it("passes through scale and offset", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [1, 0],
        [0, 1],
      ],
      { scale: [0.5, 0.25], offset: [10, 20] },
    );
    expect(li.scale).toEqual([0.5, 0.25]);
    expect(li.offset).toEqual([10, 20]);
  });

  it("throws on invalid scale via constructor", () => {
    expect(() =>
      LabelImage.fromBinaryMasks(
        [
          [1, 0],
          [0, 1],
        ],
        { scale: [0, 1] },
      ),
    ).toThrow("Scale must be positive");
  });

  it("handles uint8 0/1 values in 2D arrays", () => {
    // Simulates SAM-style output with 0/255 values
    const li = LabelImage.fromBinaryMasks([
      [
        [255, 0],
        [0, 255],
      ],
    ]);
    expect(li.labelIds).toEqual([1]);
    expect(li.data[0]).toBe(1);
    expect(li.data[3]).toBe(1);
  });
});

// --- normalizeLabelIds tests ---

describe("normalizeLabelIds", () => {
  it("assigns consistent IDs by track across frames", () => {
    const tA = new Track("A");
    const tB = new Track("B");

    const li1 = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { tracks: [tA, tB], labelIds: [3, 7] },
    );
    const li2 = LabelImage.fromBinaryMasks(
      [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0, 0],
          [0, 1],
        ],
      ],
      { tracks: [tB, tA], labelIds: [10, 20] },
    );

    const mapping = normalizeLabelIds([li1, li2]);

    // Track A appeared first (labelId=3 in frame 1), Track B second (labelId=7)
    expect(mapping.get(tA)).toBe(1);
    expect(mapping.get(tB)).toBe(2);

    // Frame 1: was [3,7] -> now [1,2]
    expect(li1.data[0]).toBe(1);
    expect(li1.data[1]).toBe(2);

    // Frame 2: tB had labelId=10 -> now 2, tA had labelId=20 -> now 1
    expect(li2.data[2]).toBe(2);
    expect(li2.data[3]).toBe(1);
  });

  it("uses first-appearance order", () => {
    const tX = new Track("X");
    const tY = new Track("Y");

    // Y appears before X in frame 0
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [0, 1],
          [0, 0],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ],
      { tracks: [tY, tX], labelIds: [1, 2] },
    );

    const mapping = normalizeLabelIds([li]);

    // Y was label ID 1 (lower), so it appears first
    expect(mapping.get(tY)).toBe(1);
    expect(mapping.get(tX)).toBe(2);
  });

  it("null tracks each get unique IDs", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      // No tracks → both null
    );

    normalizeLabelIds([li]);

    // Both should have unique IDs
    const ids = li.labelIds;
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("returns Map<Track, number>", () => {
    const t = new Track("T");
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
      ],
      { tracks: [t] },
    );
    const mapping = normalizeLabelIds([li]);
    expect(mapping).toBeInstanceOf(Map);
    expect(mapping.has(t)).toBe(true);
  });

  it("normalizes by category", () => {
    const li1 = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { categories: ["cell", "nucleus"], labelIds: [5, 10] },
    );
    const li2 = LabelImage.fromBinaryMasks(
      [
        [
          [0, 0],
          [0, 1],
        ],
      ],
      { categories: ["nucleus"], labelIds: [3] },
    );

    const mapping = normalizeLabelIds([li1, li2], {
      by: "category",
    }) as Map<string, number>;

    // "cell" appeared first (lower labelId=5), "nucleus" second
    expect(mapping.get("cell")).toBe(1);
    expect(mapping.get("nucleus")).toBe(2);
    expect(li1.data[0]).toBe(1);
    expect(li1.data[1]).toBe(2);
    expect(li2.data[3]).toBe(2);
  });

  it("merges same-category objects within a frame", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
        [
          [0, 1],
          [0, 0],
        ],
      ],
      { categories: ["cell", "cell"], labelIds: [1, 2] },
    );

    normalizeLabelIds([li], { by: "category" });

    // Both objects share category "cell", so they merge to same ID
    expect(li.data[0]).toBe(1);
    expect(li.data[1]).toBe(1);
    expect(li.nObjects).toBe(1);
  });

  it("returns Map<string, number> for category mode", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
      ],
      { categories: ["cell"] },
    );
    const mapping = normalizeLabelIds([li], { by: "category" });
    expect(mapping).toBeInstanceOf(Map);
    expect((mapping as Map<string, number>).has("cell")).toBe(true);
  });

  it("handles empty input", () => {
    const mapping = normalizeLabelIds([]);
    expect(mapping.size).toBe(0);
  });

  it("single frame already normalized is a no-op", () => {
    const t = new Track("T");
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
      ],
      { tracks: [t] },
    );
    normalizeLabelIds([li]);
    expect(li.labelIds).toEqual([1]);
    expect(li.objects.get(1)!.track).toBe(t);
  });

  it("mutates data and objects in place", () => {
    const t = new Track("T");
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
      ],
      { tracks: [t], labelIds: [5] },
    );

    expect(li.data[0]).toBe(5);
    normalizeLabelIds([li]);
    expect(li.data[0]).toBe(1);
    expect(li.objects.has(1)).toBe(true);
    expect(li.objects.has(5)).toBe(false);
  });

  it("preserves video/frameIdx/source metadata", () => {
    const li = LabelImage.fromBinaryMasks(
      [
        [
          [1, 0],
          [0, 0],
        ],
      ],
      { frameIdx: 7, source: "test.png" },
    );
    normalizeLabelIds([li]);
    expect(li.frameIdx).toBe(7);
    expect(li.source).toBe("test.png");
  });

  it("works with PredictedLabelImage", () => {
    const t = new Track("T");
    const { data, height, width } = makeLabelData([
      [5, 0],
      [0, 0],
    ]);
    const objects = new Map<number, LabelImageObjectInfo>([
      [5, { track: t, category: "cell", name: "", instance: null }],
    ]);
    const pli = new PredictedLabelImage({
      data,
      height,
      width,
      objects,
      score: 0.95,
    });

    const mapping = normalizeLabelIds([pli]);
    expect(mapping.get(t)).toBe(1);
    expect(pli.data[0]).toBe(1);
    expect(pli.score).toBe(0.95); // score preserved
    expect(pli).toBeInstanceOf(PredictedLabelImage);
  });
});
