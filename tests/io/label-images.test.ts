import { describe, it, expect } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadLabelImages,
  inferAxes,
  inferLabelIdsFromPages,
} from "../../src/io/label-images";
import "../../src/io/label-images-node"; // register node:fs reader
import { Track } from "../../src/model/instance";

// ---------------------------------------------------------------------------
// Minimal little-endian, uncompressed, strip-based TIFF writer (one strip per
// page). Adapted from the design prototype's make_tiff.ts. The `tiff` package is
// decode-only, so tests synthesize their own fixtures.
// ---------------------------------------------------------------------------

interface PageSpec {
  width: number;
  height: number;
  bitsPerSample: 8 | 16 | 32;
  pixels: number[]; // row-major, length width*height (short arrays zero-padded)
  description?: string;
  sampleFormat?: number; // 1=uint(default), 2=int, 3=float
  samplesPerPixel?: number; // default 1
}

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_ASCII = 2;

function makeTiff(pages: PageSpec[]): Uint8Array {
  const HEADER = 8;
  const ifdByteSize = (p: PageSpec): number => {
    let n = 9; // base tags
    if (p.description !== undefined) n += 1;
    if (p.sampleFormat !== undefined) n += 1;
    return 2 + n * 12 + 4;
  };

  let cursor = HEADER;
  const layout = pages.map((p) => {
    const ifdOffset = cursor;
    cursor += ifdByteSize(p);
    let descOffset = 0;
    let descBytes = 0;
    if (p.description !== undefined) {
      descBytes = new TextEncoder().encode(p.description).length + 1;
      descOffset = cursor;
      cursor += descBytes;
      if (cursor % 2 !== 0) cursor += 1;
    }
    const bytesPerSample = p.bitsPerSample / 8;
    const stripBytes =
      p.width * p.height * (p.samplesPerPixel ?? 1) * bytesPerSample;
    const stripOffset = cursor;
    cursor += stripBytes;
    if (cursor % 2 !== 0) cursor += 1;
    return { p, ifdOffset, descOffset, descBytes, stripOffset, stripBytes };
  });

  const buf = new Uint8Array(cursor);
  const dv = new DataView(buf.buffer);
  const LE = true;
  buf[0] = 0x49;
  buf[1] = 0x49;
  dv.setUint16(2, 42, LE);
  dv.setUint32(4, layout[0].ifdOffset, LE);

  for (let i = 0; i < layout.length; i++) {
    const L = layout[i];
    const p = L.p;
    const nextIFD = i + 1 < layout.length ? layout[i + 1].ifdOffset : 0;
    const entries: {
      tag: number;
      type: number;
      count: number;
      value: number;
    }[] = [];
    entries.push({ tag: 256, type: TYPE_SHORT, count: 1, value: p.width });
    entries.push({ tag: 257, type: TYPE_SHORT, count: 1, value: p.height });
    entries.push({
      tag: 258,
      type: TYPE_SHORT,
      count: 1,
      value: p.bitsPerSample,
    });
    entries.push({ tag: 259, type: TYPE_SHORT, count: 1, value: 1 }); // no compression
    entries.push({ tag: 262, type: TYPE_SHORT, count: 1, value: 1 }); // BlackIsZero
    if (p.description !== undefined) {
      entries.push({
        tag: 270,
        type: TYPE_ASCII,
        count: L.descBytes,
        value: L.descOffset,
      });
    }
    entries.push({ tag: 273, type: TYPE_LONG, count: 1, value: L.stripOffset });
    entries.push({
      tag: 277,
      type: TYPE_SHORT,
      count: 1,
      value: p.samplesPerPixel ?? 1,
    });
    entries.push({ tag: 278, type: TYPE_SHORT, count: 1, value: p.height });
    entries.push({ tag: 279, type: TYPE_LONG, count: 1, value: L.stripBytes });
    if (p.sampleFormat !== undefined) {
      entries.push({
        tag: 339,
        type: TYPE_SHORT,
        count: 1,
        value: p.sampleFormat,
      });
    }
    entries.sort((a, b) => a.tag - b.tag);

    let o = L.ifdOffset;
    dv.setUint16(o, entries.length, LE);
    o += 2;
    for (const e of entries) {
      dv.setUint16(o, e.tag, LE);
      dv.setUint16(o + 2, e.type, LE);
      dv.setUint32(o + 4, e.count, LE);
      if (e.type === TYPE_SHORT && e.count === 1) {
        dv.setUint16(o + 8, e.value, LE);
        dv.setUint16(o + 10, 0, LE);
      } else {
        dv.setUint32(o + 8, e.value, LE);
      }
      o += 12;
    }
    dv.setUint32(o, nextIFD, LE);

    if (p.description !== undefined) {
      const enc = new TextEncoder().encode(p.description);
      buf.set(enc, L.descOffset);
      buf[L.descOffset + enc.length] = 0;
    }
    if (p.bitsPerSample === 8) {
      for (let k = 0; k < p.pixels.length; k++)
        buf[L.stripOffset + k] = p.pixels[k] & 0xff;
    } else if (p.bitsPerSample === 16) {
      for (let k = 0; k < p.pixels.length; k++)
        dv.setUint16(L.stripOffset + k * 2, p.pixels[k] & 0xffff, LE);
    } else {
      for (let k = 0; k < p.pixels.length; k++)
        dv.setUint32(L.stripOffset + k * 4, p.pixels[k] >>> 0, LE);
    }
  }
  return buf;
}

/** Build a page from a 2D number array. */
function page(rows: number[][], opts?: Partial<PageSpec>): PageSpec {
  const height = rows.length;
  const width = rows[0].length;
  const pixels: number[] = [];
  for (const row of rows) pixels.push(...row);
  return { width, height, bitsPerSample: 8, pixels, ...opts };
}

const blobOf = (bytes: Uint8Array): Blob =>
  new Blob([bytes.buffer as ArrayBuffer]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("inferAxes", () => {
  it("single page is YX", () => {
    expect(inferAxes(undefined, 1)).toBe("YX");
  });
  it("plain multipage with no metadata is unknown", () => {
    expect(inferAxes(undefined, 3)).toBe("unknown");
  });
  it("ImageJ multi-channel single-frame is CYX", () => {
    expect(
      inferAxes("ImageJ=1.53\nimages=3\nchannels=3\nslices=1\nframes=1\n", 3),
    ).toBe("CYX");
  });
  it("ImageJ z/time stack is TYX", () => {
    expect(inferAxes("ImageJ=1.53\nimages=3\nslices=3\n", 3)).toBe("TYX");
    expect(inferAxes("ImageJ=1.53\nimages=4\nframes=4\n", 4)).toBe("TYX");
  });
  it("ImageJ channels+frames is TCYX", () => {
    expect(inferAxes("ImageJ=1.53\nimages=4\nchannels=2\nframes=2\n", 4)).toBe(
      "TCYX",
    );
  });
  it("OME SizeC>1 single timepoint is CYX", () => {
    const ome =
      '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image><Pixels SizeC="3" SizeT="1" SizeZ="1" SizeX="4" SizeY="4" DimensionOrder="XYCZT"/></Image></OME>';
    expect(inferAxes(ome, 3)).toBe("CYX");
  });
});

describe("inferLabelIdsFromPages", () => {
  it("preserves distinct single-class page IDs", () => {
    expect(inferLabelIdsFromPages([[[5, 0]], [[0, 17]], [[99, 0]]])).toEqual([
      5, 17, 99,
    ]);
  });
  it("returns null for colliding IDs (purely binary)", () => {
    expect(inferLabelIdsFromPages([[[1, 0]], [[0, 1]]])).toBeNull();
  });
  it("returns null when a page has multiple positive values", () => {
    expect(inferLabelIdsFromPages([[[1, 2]], [[0, 3]]])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadLabelImages — time mode
// ---------------------------------------------------------------------------

describe("loadLabelImages — time mode", () => {
  it("reads a single page as one label image", async () => {
    const tiff = makeTiff([
      page([
        [0, 1],
        [2, 0],
      ]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff));
    expect(lis).toHaveLength(1);
    expect(lis[0].height).toBe(2);
    expect(lis[0].width).toBe(2);
    expect(lis[0].labelIds).toEqual([1, 2]);
  });

  it("preserves per-page integer values across a multi-page time stack", async () => {
    // Each page has 2+ distinct labels -> not a class stack -> time, no warning.
    const tiff = makeTiff([
      page([
        [0, 1],
        [2, 0],
      ]),
      page([
        [3, 0],
        [0, 4],
      ]),
      page([
        [5, 6],
        [0, 0],
      ]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), { pagesAs: "time" });
    expect(lis).toHaveLength(3);
    expect(lis[0].labelIds).toEqual([1, 2]);
    expect(lis[1].labelIds).toEqual([3, 4]);
    expect(lis[2].labelIds).toEqual([5, 6]);
  });

  it("uint16 values survive intact", async () => {
    const tiff = makeTiff([
      page(
        [
          [0, 60000],
          [300, 0],
        ],
        { bitsPerSample: 16 },
      ),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), { pagesAs: "time" });
    expect(lis[0].labelIds).toEqual([300, 60000]);
  });

  it("createTracks:false yields no tracks; true auto-creates shared tracks", async () => {
    const tiff = makeTiff([
      page([
        [0, 1],
        [2, 0],
      ]),
      page([
        [1, 0],
        [0, 2],
      ]),
    ]);
    const trackless = await loadLabelImages(blobOf(tiff), { pagesAs: "time" });
    expect(trackless[0].tracks).toEqual([]);

    const tracked = await loadLabelImages(blobOf(tiff), {
      pagesAs: "time",
      createTracks: true,
    });
    expect(tracked[0].tracks).toHaveLength(2);
    // Shared Track objects across frames (same label IDs).
    expect(tracked[0].objects.get(1)!.track).toBe(
      tracked[1].objects.get(1)!.track,
    );
  });

  it("applies categories by label ID (Map) in time mode", async () => {
    const tiff = makeTiff([
      page([
        [0, 1],
        [2, 0],
      ]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "time",
      categories: new Map([
        [1, "cell"],
        [2, "nucleus"],
      ]),
    });
    expect(lis[0].objects.get(1)!.category).toBe("cell");
    expect(lis[0].objects.get(2)!.category).toBe("nucleus");
  });

  it("honors explicit tracks (positional)", async () => {
    const tiff = makeTiff([
      page([
        [0, 1],
        [2, 0],
      ]),
    ]);
    const a = new Track("A");
    const b = new Track("B");
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "time",
      tracks: [a, b],
    });
    expect(lis[0].objects.get(1)!.track).toBe(a);
    expect(lis[0].objects.get(2)!.track).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// loadLabelImages — classes mode
// ---------------------------------------------------------------------------

describe("loadLabelImages — classes mode", () => {
  it("composites single-class pages and preserves distinct COCO IDs", async () => {
    const tiff = makeTiff([
      page([
        [5, 0],
        [0, 0],
      ]),
      page([
        [0, 17],
        [0, 0],
      ]),
      page([
        [0, 0],
        [99, 0],
      ]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), { pagesAs: "classes" });
    expect(lis).toHaveLength(1);
    expect(lis[0].labelIds).toEqual([5, 17, 99]);
  });

  it("renumbers positionally 1..N for purely-binary pages", async () => {
    const tiff = makeTiff([
      page([
        [1, 0],
        [0, 0],
      ]),
      page([
        [0, 1],
        [0, 0],
      ]),
      page([
        [0, 0],
        [1, 0],
      ]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), { pagesAs: "classes" });
    expect(lis[0].labelIds).toEqual([1, 2, 3]);
  });

  it("assigns positional categories per class", async () => {
    const tiff = makeTiff([page([[1, 0]]), page([[0, 1]])]);
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "classes",
      categories: ["cell", "debris"],
    });
    expect(lis[0].objects.get(1)!.category).toBe("cell");
    expect(lis[0].objects.get(2)!.category).toBe("debris");
  });
});

// ---------------------------------------------------------------------------
// auto-detection
// ---------------------------------------------------------------------------

describe("loadLabelImages — auto detection", () => {
  it("ImageJ CYX metadata routes to classes (1 image)", async () => {
    const desc =
      "ImageJ=1.53\nimages=3\nchannels=3\nslices=1\nframes=1\nhyperstack=true\n";
    // Distinct pixel positions per class so composited IDs don't overlap.
    const tiff = makeTiff([
      page([[5, 0, 0]], { description: desc }),
      page([[0, 17, 0]]),
      page([[0, 0, 99]]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff)); // auto
    expect(lis).toHaveLength(1);
    expect(lis[0].labelIds).toEqual([5, 17, 99]);
  });

  it("ImageJ time metadata routes to time (N images)", async () => {
    const desc = "ImageJ=1.53\nimages=3\nslices=3\n";
    const tiff = makeTiff([
      page([[1, 2]], { description: desc }),
      page([[3, 0]]),
      page([[0, 4]]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff)); // auto
    expect(lis).toHaveLength(3);
  });

  it("OME CYX metadata routes to classes", async () => {
    const ome =
      '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image><Pixels SizeC="2" SizeT="1" SizeZ="1"/></Image></OME>';
    const tiff = makeTiff([
      page([[7, 0]], { description: ome }),
      page([[0, 8]]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff));
    expect(lis).toHaveLength(1);
    expect(lis[0].labelIds).toEqual([7, 8]);
  });

  it("TCYX metadata throws a clear deferred error", async () => {
    const desc = "ImageJ=1.53\nimages=4\nchannels=2\nframes=2\n";
    const tiff = makeTiff([
      page([[1, 0]], { description: desc }),
      page([[0, 1]]),
      page([[1, 0]]),
      page([[0, 1]]),
    ]);
    await expect(loadLabelImages(blobOf(tiff))).rejects.toThrow("TCYX");
  });

  it("warns and routes to time for an ambiguous plain class-like stack", async () => {
    const tiff = makeTiff([page([[1, 0]]), page([[0, 1]]), page([[1, 0]])]);
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      const lis = await loadLabelImages(blobOf(tiff), {
        source: "ambiguous-uniq.tif",
      });
      expect(lis).toHaveLength(3); // routed to time
    } finally {
      console.warn = orig;
    }
    expect(
      warnings.some(
        (w) => /multi-page TIFF/.test(w) && /pagesAs: 'classes'/.test(w),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// frames subset, errors, node path / directory
// ---------------------------------------------------------------------------

describe("loadLabelImages — frames, errors, paths", () => {
  it("selects a subset of pages with frames", async () => {
    const tiff = makeTiff([
      page([[1, 2]]),
      page([[3, 4]]),
      page([[5, 6]]),
      page([[7, 8]]),
    ]);
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "time",
      frames: [0, 2],
    });
    expect(lis).toHaveLength(2);
    expect(lis[0].labelIds).toEqual([1, 2]);
    expect(lis[1].labelIds).toEqual([5, 6]);
  });

  it("throws a clear error for 32-bit integer TIFFs", async () => {
    const tiff = makeTiff([
      page(
        [
          [1, 2],
          [3, 4],
        ],
        { bitsPerSample: 32, sampleFormat: 1 },
      ),
    ]);
    await expect(
      loadLabelImages(blobOf(tiff), { pagesAs: "time" }),
    ).rejects.toThrow(/8- and 16-bit unsigned/);
  });

  it("rejects floating-point TIFFs (not silently truncated)", async () => {
    const tiff = makeTiff([
      page(
        [
          [1, 2],
          [3, 4],
        ],
        { bitsPerSample: 32, sampleFormat: 3 },
      ),
    ]);
    await expect(
      loadLabelImages(blobOf(tiff), { pagesAs: "time" }),
    ).rejects.toThrow(/Floating-point/);
  });

  it("rejects multi-channel (RGB) TIFFs", async () => {
    const tiff = makeTiff([
      { width: 2, height: 1, bitsPerSample: 8, samplesPerPixel: 3, pixels: [] },
    ]);
    await expect(
      loadLabelImages(blobOf(tiff), { pagesAs: "time" }),
    ).rejects.toThrow(/single-channel/);
  });

  it("assigns class-mode categories from a Map (positional 1..N keys)", async () => {
    const tiff = makeTiff([page([[7, 0]]), page([[0, 8]])]);
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "classes",
      categories: new Map([
        [1, "cell"],
        [2, "debris"],
      ]),
    });
    // Categories key by positional post-composite IDs 1..N, even though the
    // preserved label IDs are 7 and 8.
    expect(lis[0].objects.get(7)!.category).toBe("cell");
    expect(lis[0].objects.get(8)!.category).toBe("debris");
  });

  it("ignores out-of-range frame indices", async () => {
    const tiff = makeTiff([page([[1, 2]]), page([[3, 4]]), page([[5, 6]])]);
    const lis = await loadLabelImages(blobOf(tiff), {
      pagesAs: "time",
      frames: [0, 5, 2],
    });
    expect(lis).toHaveLength(2); // 5 is out of range -> dropped
    expect(lis[0].labelIds).toEqual([1, 2]);
    expect(lis[1].labelIds).toEqual([5, 6]);
  });

  it("selects a subset of files from a directory with frames", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-dirf-"));
    fs.writeFileSync(path.join(dir, "00.tif"), makeTiff([page([[1, 0]])]));
    fs.writeFileSync(path.join(dir, "01.tif"), makeTiff([page([[0, 2]])]));
    fs.writeFileSync(path.join(dir, "02.tif"), makeTiff([page([[3, 0]])]));
    try {
      const lis = await loadLabelImages(dir, {
        pagesAs: "time",
        frames: [0, 2],
      });
      expect(lis).toHaveLength(2);
      expect(lis[0].labelIds).toEqual([1]);
      expect(lis[1].labelIds).toEqual([3]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for an empty directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-empty-"));
    try {
      expect(await loadLabelImages(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on an invalid pagesAs value", async () => {
    const tiff = makeTiff([page([[1, 0]])]);
    // @ts-expect-error testing runtime validation
    await expect(
      loadLabelImages(blobOf(tiff), { pagesAs: "bogus" }),
    ).rejects.toThrow("pagesAs must be");
  });

  it("reads a .tif from a path (node:fs reader)", async () => {
    const tiff = makeTiff([
      page([
        [10, 0],
        [0, 20],
      ]),
      page([
        [0, 30],
        [40, 0],
      ]),
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-test-"));
    const file = path.join(dir, "labels.tif");
    fs.writeFileSync(file, tiff);
    try {
      const lis = await loadLabelImages(file, { pagesAs: "time" });
      expect(lis).toHaveLength(2);
      expect(lis[0].labelIds).toEqual([10, 20]);
      expect(lis[1].labelIds).toEqual([30, 40]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a directory of single-frame TIFFs (alphanumeric order)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-dir-"));
    fs.writeFileSync(path.join(dir, "00.tif"), makeTiff([page([[1, 0]])]));
    fs.writeFileSync(path.join(dir, "01.tif"), makeTiff([page([[0, 2]])]));
    fs.writeFileSync(path.join(dir, "02.tiff"), makeTiff([page([[3, 0]])]));
    try {
      const lis = await loadLabelImages(dir, { pagesAs: "time" });
      expect(lis).toHaveLength(3);
      expect(lis[0].labelIds).toEqual([1]);
      expect(lis[1].labelIds).toEqual([2]);
      expect(lis[2].labelIds).toEqual([3]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
