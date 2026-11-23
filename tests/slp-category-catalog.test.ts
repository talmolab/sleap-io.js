/**
 * Project-level category catalog: `Labels.categories` (SLP 2.7 `/categories`).
 *
 * Detections keep `category` as a string; the catalog holds `Category` objects
 * (name + color + metadata), may hold classes no detection uses yet, and
 * round-trips through every reader and writer, matching Python's
 * `Labels.categories` / `read_categories` / `write_categories`.
 *
 * `py_written_27_category_catalog.slp` was written by Python sleap-io 0.9.3:
 *
 *   mouse = Category(name="mouse", metadata={"color": "#e6194b"})
 *   arena = Category(name="arena", metadata={"color": "#3cb44b", "supercategory": "env"})
 *   unused = Category(name="unused")
 *   mask = UserSegmentationMask.from_numpy(raster_8x8, category=mouse)
 *   Labels(labeled_frames=[LabeledFrame(..., masks=[mask])],
 *          categories=[mouse, arena, unused]).save(path)
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { openSlpWriter, saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import { Category } from "../src/model/category.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { UserSegmentationMask } from "../src/model/mask.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const PY_CATALOG = path.join(
  fixtureRoot,
  "slp",
  "py_written_27_category_catalog.slp",
);

const SK = new Skeleton({ nodes: ["A", "B"], edges: [] });

function maskOf(category: string): UserSegmentationMask {
  const raster = new Uint8Array(64);
  raster[2 * 8 + 3] = 1;
  return UserSegmentationMask.fromArray(raster, 8, 8, { category });
}

/** A catalog with an unused class, colors and extra metadata; one mask uses it. */
function catalogLabels(extraMaskCategory?: string): Labels {
  const video = new Video({ filename: "v.mp4" });
  const inst = Instance.fromArray(
    [
      [1, 2],
      [3, 4],
    ],
    SK,
  );
  const masks = [maskOf("mouse")];
  if (extraMaskCategory) masks.push(maskOf(extraMaskCategory));
  const lf = new LabeledFrame({
    video,
    frameIdx: 0,
    instances: [inst],
    masks,
  });
  return new Labels({
    labeledFrames: [lf],
    videos: [video],
    skeletons: [SK],
    categories: [
      new Category({ name: "mouse", color: "#e6194b" }),
      new Category({
        name: "arena",
        color: "#3cb44b",
        metadata: { supercategory: "env" },
      }),
      new Category({ name: "unused" }),
    ],
  });
}

/** Comparable view of a catalog. */
function catalogSig(categories: Category[]) {
  return categories.map((c) => ({
    name: c.name,
    color: c.color,
    metadata: c.metadata,
  }));
}

const EXPECTED = [
  { name: "mouse", color: "#e6194b", metadata: {} },
  { name: "arena", color: "#3cb44b", metadata: { supercategory: "env" } },
  { name: "unused", color: undefined, metadata: {} },
];

async function bytesOf(labels: Labels): Promise<ArrayBuffer> {
  return new Uint8Array(await saveSlpToBytes(labels)).buffer as ArrayBuffer;
}

function decodeNames(ds: any): string[] {
  return Array.from(ds.value as ArrayLike<unknown>).map((n) =>
    typeof n === "string" ? n : new TextDecoder().decode(n as Uint8Array),
  );
}

async function readStoredCatalog(buf: ArrayBuffer) {
  const { file, close } = await openH5File(buf);
  try {
    const attrs = (file.get("metadata") as any).attrs ?? {};
    return {
      formatId: Number(attrs.format_id?.value ?? attrs.format_id),
      names: file.get("categories/name")
        ? decodeNames(file.get("categories/name"))
        : [],
      metaKeys: file.get("categories/meta_key")
        ? decodeNames(file.get("categories/meta_key"))
        : [],
      hasLinks: file.get("categories/links") != null,
    };
  } finally {
    close();
  }
}

/** A Node-side `StreamingH5File` over h5wasm (the real one needs a Worker). */
async function fakeStreamingFile(buf: ArrayBuffer) {
  const module = await ready;
  try {
    module.FS.mkdir("/tmp");
  } catch {
    // already exists
  }
  const p = `/tmp/cat_catalog_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
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

describe("Labels.categories (SLP 2.7 catalog)", () => {
  it("defaults to an empty catalog", () => {
    expect(new Labels().categories).toEqual([]);
  });

  it("round-trips the catalog, unused classes and metadata (eager)", async () => {
    const loaded = await readSlp(await bytesOf(catalogLabels()), {
      openVideos: false,
    });
    expect(loaded.categories.every((c) => c instanceof Category)).toBe(true);
    expect(catalogSig(loaded.categories)).toEqual(EXPECTED);
    expect(loaded.labeledFrames[0].masks[0].category).toBe("mouse");
  });

  it("writes /categories with metadata; color folds into meta 'color'", async () => {
    const stored = await readStoredCatalog(await bytesOf(catalogLabels()));
    expect(stored.formatId).toBeCloseTo(2.7);
    expect(stored.names).toEqual(["mouse", "arena", "unused"]);
    expect(stored.metaKeys.sort()).toEqual(["color", "color", "supercategory"]);
    expect(stored.hasLinks).toBe(true);
  });

  it("appends category strings the catalog lacks, after the declared ones", async () => {
    const buf = await bytesOf(catalogLabels("cage"));
    expect((await readStoredCatalog(buf)).names).toEqual([
      "mouse",
      "arena",
      "unused",
      "cage",
    ]);
    const loaded = await readSlp(buf, { openVideos: false });
    expect(loaded.labeledFrames[0].masks.map((m) => m.category)).toEqual([
      "mouse",
      "cage",
    ]);
  });

  it("a catalog alone (no categorized detection) bumps to 2.7, no links", async () => {
    const video = new Video({ filename: "v.mp4" });
    const labels = new Labels({
      videos: [video],
      skeletons: [SK],
      categories: [new Category({ name: "mouse", color: "#e6194b" })],
    });
    const buf = await bytesOf(labels);
    const stored = await readStoredCatalog(buf);
    expect(stored.formatId).toBeCloseTo(2.7);
    expect(stored.names).toEqual(["mouse"]);
    expect(stored.hasLinks).toBe(false);
    const loaded = await readSlp(buf, { openVideos: false });
    expect(catalogSig(loaded.categories)).toEqual([
      { name: "mouse", color: "#e6194b", metadata: {} },
    ]);
  });

  it("files without a catalog still write no /categories group", async () => {
    const labels = new Labels({
      videos: [new Video({ filename: "v.mp4" })],
      skeletons: [SK],
    });
    const stored = await readStoredCatalog(await bytesOf(labels));
    expect(stored.formatId).toBeLessThan(2.7);
    expect(stored.names).toEqual([]);
  });

  it("reads the catalog lazily and keeps it through a lazy re-save", async () => {
    const lazy = await readSlpLazy(await bytesOf(catalogLabels()), {
      openVideos: false,
    });
    expect(lazy.isLazy).toBe(true);
    expect(catalogSig(lazy.categories)).toEqual(EXPECTED);

    const resaved = await bytesOf(lazy);
    expect(lazy.isLazy).toBe(true); // took the lazy fast path
    const back = await readSlp(resaved, { openVideos: false });
    expect(catalogSig(back.categories)).toEqual(EXPECTED);
    expect(back.labeledFrames[0].masks[0].category).toBe("mouse");
  });

  it("reads the catalog through the streaming reader (eager and lazy)", async () => {
    const buf = await bytesOf(catalogLabels());
    for (const lazy of [false, true]) {
      const { fake, close } = await fakeStreamingFile(buf);
      try {
        const labels = await readStreaming(fake, lazy);
        expect(catalogSig(labels.categories)).toEqual(EXPECTED);
      } finally {
        close();
      }
    }
  });

  it("the streaming writer writes the header's catalog", async () => {
    const video = new Video({ filename: "v.mp4" });
    const writer = await openSlpWriter({
      skeletons: [SK],
      videos: [video],
      categories: [new Category({ name: "mouse", color: "#e6194b" })],
    });
    const buf = new Uint8Array(writer.close()).buffer as ArrayBuffer;
    const loaded = await readSlp(buf, { openVideos: false });
    expect(catalogSig(loaded.categories)).toEqual([
      { name: "mouse", color: "#e6194b", metadata: {} },
    ]);
  });

  it("reads a Python-written catalog with metadata and an unused class", async () => {
    const loaded = await readSlp(
      new Uint8Array(readFileSync(PY_CATALOG)).buffer as ArrayBuffer,
      { openVideos: false },
    );
    expect(catalogSig(loaded.categories)).toEqual(EXPECTED);
    expect(loaded.labeledFrames[0].masks[0].category).toBe("mouse");
  });

  it("copy() deep-copies the catalog as Category objects", () => {
    const labels = catalogLabels();
    const copy = labels.copy();
    expect(catalogSig(copy.categories)).toEqual(EXPECTED);
    expect(copy.categories[0]).toBeInstanceOf(Category);
    expect(copy.categories[0]).not.toBe(labels.categories[0]);
    copy.categories[1].metadata.supercategory = "changed";
    expect(labels.categories[1].metadata.supercategory).toBe("env");
  });

  it("merge() unions catalogs by name, keeping the target's entries", async () => {
    const base = new Labels({
      categories: [new Category({ name: "mouse", color: "#000000" })],
    });
    const other = new Labels({
      categories: [
        new Category({ name: "mouse", color: "#ffffff" }),
        new Category({ name: "arena", color: "#3cb44b" }),
      ],
    });
    await base.merge(other);
    expect(catalogSig(base.categories)).toEqual([
      { name: "mouse", color: "#000000", metadata: {} },
      { name: "arena", color: "#3cb44b", metadata: {} },
    ]);
    expect(base.categories[1]).not.toBe(other.categories[1]);
  });
});
