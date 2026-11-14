/**
 * `Labels.provenance` stored in the top-level `/provenance_json` dataset, as
 * Python sleap-io (talmolab/sleap-io#517).
 *
 * Readers prefer the dataset and fall back to the `metadata/json` attribute's
 * `provenance` key. Writers write the dataset when provenance is non-empty and
 * keep mirroring it into the attribute, which drops its largest droppable keys
 * when it would exceed HDF5's 64 KB attribute limit. The in-place writer never
 * rewrites the dataset, so its gate refuses any provenance change.
 *
 * Python-written fixtures (see `data/slp/gen_provenance_json_fixture.py`):
 * - `provenance_json_small.slp`: small provenance, in the dataset AND the attr.
 * - `provenance_json_large.slp`: an 800-entry `merge_history`, ONLY in the
 *   dataset (the attr has no `provenance` key).
 */
import { describe, it, expect, vi } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import {
  saveSlpToBytes,
  openSlpWriter,
  saveSlpMergedFromStores,
  buildMetadataJson,
  buildExpectedSidecars,
  buildLabelTableUpdate,
  checkInPlaceWritable,
} from "../src/codecs/slp/write.js";
import {
  METADATA_ATTR_SIZE_LIMIT,
  decodeProvenanceDataset,
  encodeMetadataAttr,
} from "../src/codecs/slp/provenance.js";
import { loadSlpMetadata } from "../src/lite.js";
import { loadSlp } from "../src/io/main.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const slpPath = (name: string) => path.join(fixtureRoot, "slp", name);
const SCRATCH = mkdtempSync(path.join(tmpdir(), "sleap-provenance-json-"));

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function writeTmp(bytes: Uint8Array): string {
  const p = path.join(
    SCRATCH,
    `${Date.now()}_${Math.random().toString(16).slice(2)}.slp`,
  );
  writeFileSync(p, bytes);
  return p;
}

function makeLabels(provenance: Record<string, unknown>): Labels {
  const skeleton = new Skeleton({ name: "s", nodes: ["A", "B"] });
  const video = new Video({ filename: "vid.mp4" });
  const inst = new Instance({
    skeleton,
    points: [
      { xy: [1, 2], visible: true, complete: true },
      { xy: [3, 4], visible: true, complete: true },
    ],
  });
  return new Labels({
    labeledFrames: [
      new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
    ],
    videos: [video],
    skeletons: [skeleton],
    provenance,
  });
}

/** A provenance well over the 64 KB attribute limit (5,000-item list). */
function largeProvenance(): Record<string, unknown> {
  return {
    sleap_version: "js-test",
    merge_history: Array.from({ length: 5000 }, (_, i) => ({
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}`,
      source_filename: `/data/session_${i}/labels.slp`,
    })),
  };
}

/** What a file holds on disk: the dataset (text, shape) and the metadata attr. */
async function inspect(filePath: string): Promise<{
  datasetText: string | null;
  datasetShape: number[] | null;
  attrJson: string;
  attr: Record<string, unknown>;
}> {
  await ready;
  const f = new H5File(filePath, "r");
  try {
    const keys = f.keys();
    let datasetText: string | null = null;
    let datasetShape: number[] | null = null;
    if (keys.includes("provenance_json")) {
      const ds = f.get("provenance_json") as unknown as {
        value: unknown;
        shape: number[];
      };
      datasetShape = ds.shape;
      datasetText = decodeProvenanceDataset(ds.value)
        ? JSON.stringify(decodeProvenanceDataset(ds.value))
        : String(ds.value);
    }
    const md = f.get("metadata") as unknown as {
      attrs: Record<string, { value: unknown }>;
    };
    const raw = md.attrs.json.value;
    const attrJson =
      typeof raw === "string" ? raw : new TextDecoder().decode(raw as never);
    return {
      datasetText,
      datasetShape,
      attrJson,
      attr: JSON.parse(attrJson) as Record<string, unknown>,
    };
  } finally {
    f.close();
  }
}

/** Unwrap h5wasm/node attr entries (`{ value }`) as the streaming worker does. */
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
 * Read a file through the streaming reader's orchestrator, with a fake
 * `StreamingH5File` (the real one needs a Worker): compound pose tables come
 * from a `readSlpLazy` store, everything else from `h5wasm/node`.
 */
async function readStreaming(filePath: string): Promise<Labels> {
  await ready;
  const h5 = new H5File(filePath, "r");
  const store = (await readSlpLazy(filePath, { openVideos: false }))
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
    getKeys: (dp: string) =>
      ((get(dp) as { keys?: () => string[] })?.keys?.() ?? []) as string[],
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
      if (dp in columns) return { value: columns[dp], shape: [], dtype: "" };
      const d = get(dp);
      return {
        value: d?.value,
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
  } as unknown as StreamingH5File;
  try {
    return await readFromStreamingFile(
      fake,
      filePath,
      filePath,
      false,
      undefined,
      false,
      false,
    );
  } finally {
    h5.close();
  }
}

/** Provenance as seen by every reader: eager, lazy, streaming, lite. */
async function provenanceFromAllReaders(
  filePath: string,
): Promise<Record<string, unknown>[]> {
  const buf = toArrayBuffer(readFileSync(filePath));
  const eager = await readSlp(filePath, { openVideos: false });
  const lazy = await readSlpLazy(filePath, { openVideos: false });
  const streaming = await readStreaming(filePath);
  const lite = await loadSlpMetadata(buf);
  return [
    eager.provenance,
    lazy.provenance,
    streaming.provenance,
    lite.provenance ?? {},
  ];
}

describe("reading /provenance_json", () => {
  it("reads a Python-written file with provenance in the dataset and attr", async () => {
    const all = await provenanceFromAllReaders(
      slpPath("provenance_json_small.slp"),
    );
    for (const prov of all) {
      expect(prov).toEqual({ sleap_version: "py-fixture", note: "small" });
    }
  });

  it("reads a Python-written file whose provenance is ONLY in the dataset", async () => {
    const p = slpPath("provenance_json_large.slp");
    const disk = await inspect(p);
    expect(disk.attr.provenance).toBeUndefined();
    expect(disk.datasetShape).toEqual([]); // Python's scalar np.bytes_

    for (const prov of await provenanceFromAllReaders(p)) {
      expect(prov.sleap_version).toBe("py-fixture");
      const history = prov.merge_history as Array<Record<string, unknown>>;
      expect(history.length).toBe(800);
      expect(history[799].source_filename).toBe(
        "/data/session_00799/labels.v001.slp",
      );
    }
  });

  it("still reads legacy files with provenance only in the metadata attr", async () => {
    const p = slpPath("predictions_1.2.7_provenance_and_tracking.slp");
    expect((await inspect(p)).datasetText).toBeNull();
    for (const prov of await provenanceFromAllReaders(p)) {
      expect(prov.sleap_version).toBe("1.2.7");
      expect(prov.predictor).toBe("TopDownPredictor");
    }
  });

  it("falls back to the attr when the dataset is not valid JSON", () => {
    expect(decodeProvenanceDataset("not json")).toBeUndefined();
    expect(decodeProvenanceDataset("[1, 2]")).toBeUndefined();
    expect(decodeProvenanceDataset(undefined)).toBeUndefined();
    expect(decodeProvenanceDataset(['{"a":1}'])).toEqual({ a: 1 });
    expect(
      decodeProvenanceDataset(new TextEncoder().encode('{"a":1}\0\0')),
    ).toEqual({ a: 1 });
  });

  it("re-saving a Python dataset-only file keeps the provenance", async () => {
    const labels = await readSlp(slpPath("provenance_json_large.slp"), {
      openVideos: false,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let out: string;
    try {
      out = writeTmp(await saveSlpToBytes(labels));
    } finally {
      warn.mockRestore();
    }
    const back = await readSlp(out, { openVideos: false });
    expect(back.provenance).toEqual(labels.provenance);
    expect((await inspect(out)).datasetText).toBe(
      JSON.stringify(labels.provenance),
    );
  });
});

describe("writing /provenance_json", () => {
  it("writes the dataset and mirrors small provenance into the attr", async () => {
    const prov = { sleap_version: "js", note: "héllo ✓ 🐭", n: 1.5 };
    const p = writeTmp(await saveSlpToBytes(makeLabels(prov)));
    const disk = await inspect(p);
    expect(disk.datasetShape).toEqual([]);
    expect(disk.datasetText).toBe(JSON.stringify(prov));
    expect(disk.attr.provenance).toEqual(prov);
    for (const read of await provenanceFromAllReaders(p)) {
      expect(read).toEqual(prov);
    }
  });

  it("writes no dataset for empty provenance", async () => {
    const p = writeTmp(await saveSlpToBytes(makeLabels({})));
    const disk = await inspect(p);
    expect(disk.datasetText).toBeNull();
    expect(disk.attr.provenance).toEqual({});
    expect((await readSlp(p, { openVideos: false })).provenance).toEqual({});
  });

  it("saves a >64 KB provenance: dataset holds it, attr drops it and fits", async () => {
    const prov = largeProvenance();
    expect(JSON.stringify(prov).length).toBeGreaterThan(64_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let bytes: Uint8Array;
    try {
      bytes = await saveSlpToBytes(makeLabels(prov));
      expect(
        warn.mock.calls.some((c) =>
          String(c[0]).includes("dropped top-level key(s)"),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
    const p = writeTmp(bytes);
    const disk = await inspect(p);
    expect(new TextEncoder().encode(disk.attrJson).length).toBeLessThanOrEqual(
      METADATA_ATTR_SIZE_LIMIT,
    );
    expect(disk.attr.version).toBe("2.0.0");
    expect(Array.isArray(disk.attr.skeletons)).toBe(true);
    expect(Array.isArray(disk.attr.nodes)).toBe(true);
    expect(disk.attr.provenance).toBeUndefined();
    expect(disk.datasetText).toBe(JSON.stringify(prov));
    for (const read of await provenanceFromAllReaders(p)) {
      expect(read).toEqual(prov);
    }
  });

  it("the lazy fast-path writer keeps the dataset", async () => {
    const prov = largeProvenance();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const src = writeTmp(await saveSlpToBytes(makeLabels(prov)));
      const lazy = await readSlpLazy(src, { openVideos: false });
      expect(lazy.provenance).toEqual(prov);
      const out = writeTmp(await saveSlpToBytes(lazy));
      expect(lazy.isLazy).toBe(true);
      expect((await inspect(out)).datasetText).toBe(JSON.stringify(prov));
      expect((await readSlp(out, { openVideos: false })).provenance).toEqual(
        prov,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("the embedded (raw-copy) writer keeps the dataset", async () => {
    const labels = await loadSlp(slpPath("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    labels.provenance = { note: "embedded", list: [1, 2, 3] };
    const out = writeTmp(await saveSlpToBytes(labels, { embed: "user" }));
    expect((await inspect(out)).datasetText).toBe(
      JSON.stringify(labels.provenance),
    );
    const back = await readSlp(out, { openVideos: false });
    expect(back.provenance).toEqual(labels.provenance);
  });

  it("the streaming writer and the merged-stores writer write the dataset", async () => {
    const prov = largeProvenance();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const labels = makeLabels({});
      const writer = await openSlpWriter({
        skeletons: labels.skeletons,
        videos: labels.videos,
        provenance: prov,
      });
      const streamed = writeTmp(writer.close());
      expect((await inspect(streamed)).datasetText).toBe(JSON.stringify(prov));
      expect(
        (await readSlp(streamed, { openVideos: false })).provenance,
      ).toEqual(prov);

      const src = writeTmp(await saveSlpToBytes(makeLabels({})));
      const store = (await readSlpLazy(src, { openVideos: false }))
        ._lazyDataStore;
      if (!store) throw new Error("no lazy store");
      const merged = writeTmp(
        await saveSlpMergedFromStores([store], { provenance: prov }),
      );
      expect((await inspect(merged)).datasetText).toBe(JSON.stringify(prov));
      expect((await readSlp(merged, { openVideos: false })).provenance).toEqual(
        prov,
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("metadata attr size guard", () => {
  it("buildMetadataJson applies the same guard without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const json = buildMetadataJson(makeLabels(largeProvenance()));
      expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(
        METADATA_ATTR_SIZE_LIMIT,
      );
      expect(JSON.parse(json).provenance).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops the largest droppable keys first and leaves small metadata alone", () => {
    const small = {
      version: "2.0.0",
      skeletons: [],
      nodes: [],
      provenance: {},
    };
    expect(encodeMetadataAttr(small)).toBe(JSON.stringify(small));

    const md = {
      version: "2.0.0",
      skeletons: [],
      nodes: [],
      videos: [],
      provenance: { big: "x".repeat(70_000) },
      other: { medium: "y".repeat(100) },
    };
    const json = encodeMetadataAttr(md, { warn: false });
    expect(JSON.parse(json)).toEqual({
      version: "2.0.0",
      skeletons: [],
      nodes: [],
      videos: [],
      other: { medium: "y".repeat(100) },
    });
    expect(md.provenance).toBeDefined(); // input not mutated
  });

  it("throws when the protected keys alone exceed the limit", () => {
    expect(() =>
      encodeMetadataAttr(
        { version: "2.0.0", skeletons: ["z".repeat(70_000)], nodes: [] },
        { warn: false },
      ),
    ).toThrow(/skeletons\/nodes metadata alone/);
  });
});

describe("in-place gate and provenance", () => {
  /** Gate an unchanged-tables update for `labels` against `onDisk` sidecars. */
  function gate(
    labels: Labels,
    onDisk: ReturnType<typeof buildExpectedSidecars>,
  ) {
    const update = buildLabelTableUpdate(labels, {
      metadataJson: buildMetadataJson(labels),
    });
    return checkInPlaceWritable(
      update,
      {},
      {
        onDisk,
        expected: buildExpectedSidecars(labels),
      },
    );
  }

  it("passes when provenance is unchanged", () => {
    const labels = makeLabels({ a: 1 });
    expect(gate(labels, buildExpectedSidecars(labels)).ok).toBe(true);
    // Caller didn't read the dataset: the attr mirror is compared instead.
    const { provenanceJson: _omit, ...noDataset } =
      buildExpectedSidecars(labels);
    expect(gate(labels, noDataset).ok).toBe(true);
  });

  it("refuses when provenance changed, even if the metadata attr is carried", () => {
    const onDisk = buildExpectedSidecars(makeLabels({ a: 1 }));
    const res = gate(makeLabels({ a: 2 }), onDisk);
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.reason).toMatch(/provenance changed/);

    // Same, without the caller supplying the dataset text.
    const { provenanceJson: _omit, ...noDataset } = onDisk;
    expect(gate(makeLabels({ a: 2 }), noDataset).ok).toBe(false);

    // Clearing provenance is a change too (a stale dataset would win on read).
    expect(gate(makeLabels({}), onDisk).ok).toBe(false);
  });

  it("compares semantically, not byte-for-byte (Python formatting)", () => {
    const labels = makeLabels({ a: 1, s: "é" });
    const onDisk = {
      ...buildExpectedSidecars(labels),
      provenanceJson: '{"a": 1.0, "s": "\\u00e9"}',
    };
    expect(gate(labels, onDisk).ok).toBe(true);
  });

  it("large provenance: refuses unless the caller supplies the dataset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const labels = makeLabels(largeProvenance());
      const onDisk = buildExpectedSidecars(labels);
      expect(gate(labels, onDisk).ok).toBe(true);

      // The attr has no provenance key, so without the dataset text the gate
      // can't tell whether provenance changed.
      const { provenanceJson: _omit, ...noDataset } = onDisk;
      const res = gate(labels, noDataset);
      expect(res.ok).toBe(false);
      expect(res.ok ? "" : res.reason).toMatch(/could not be determined/);
    } finally {
      warn.mockRestore();
    }
  });
});
