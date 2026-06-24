// src/io/label-images.ts
//
// Reader for dense integer LABEL-IMAGE TIFFs (one label ID per pixel), produced
// by segmentation tools (Cellpose, StarDist, ImageJ, ilastik, ...). Port of the
// read path of Python sleap-io's `sleap_io/io/tiff.py` `read_label_images`
// (talmolab/sleap-io PR #421); see issue #140 for scope/decisions.
//
// Browser-reachable: this module must NOT statically import `node:fs`. Decoding
// uses the optional `tiff` package (lazy-imported). Path reading on Node is
// provided through an injected reader (see `label-images-node.ts`); browsers
// pass a `File`/`Blob`.

import { LabelImage, UserLabelImage } from "../model/label-image.js";
import type { Track } from "../model/instance.js";

/** How TIFF pages map onto LabelImage frames. Mirrors Python `pages_as`. */
export type PagesAs = "auto" | "time" | "classes";

export interface LoadLabelImagesOptions {
  /** Page→frame mapping. Default `"auto"` (parity with Python). */
  pagesAs?: PagesAs;
  /**
   * Auto-create one Track per unique non-zero label ID (shared across frames).
   * Default `false` — pure-segmentation parity with `LabelImage.fromArray`
   * (PR #387). Ignored in `classes` mode (matches Python). Time mode only.
   */
  createTracks?: boolean;
  /** Explicit Track assignment by label ID (`Map`) or positional (`Track[]`). Time mode. */
  tracks?: Map<number, Track> | Track[] | null;
  /**
   * Explicit category assignment. `Map<id,string>` (by label ID) in time mode;
   * `string[]` (positional, one per class) in classes mode.
   */
  categories?: Map<number, string> | string[] | null;
  /** Decode only this subset of pages (0-based), in order. Default: all pages. */
  frames?: number[] | null;
  /** Source string stored on each LabelImage. Defaults to filename / blob name. */
  source?: string;
}

/**
 * Reader for a `.tif`/`.tiff` path (Node only). Returns the file bytes, or a
 * list of per-file byte arrays for a directory. Registered by
 * `label-images-node.ts`; absent in the browser graph (issue #70).
 */
export type LabelImageFileReader = (
  path: string,
) => Promise<Uint8Array | { files: Uint8Array[] }>;

let fileReader: LabelImageFileReader | null = null;

/** Register the Node `node:fs`-backed TIFF path reader. */
export function setLabelImageFileReader(fn: LabelImageFileReader | null): void {
  fileReader = fn;
}

// Minimal shape of a decoded TIFF IFD from the `tiff` package.
interface TiffIfdLike {
  width: number;
  height: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  sampleFormat?: number;
  imageDescription?: string;
  data: ArrayLike<number>;
}

type Layout = "YX" | "TYX" | "CYX" | "TCYX" | "unknown";

// One-shot ambiguous-multipage warnings, deduped by message text (Python relies
// on the stdlib `warnings` once-per-site filter; JS has no equivalent).
const warnedMessages = new Set<string>();

async function decodeTiff(
  bytes: Uint8Array,
  opts?: { pages?: number[]; ignoreImageData?: boolean },
): Promise<TiffIfdLike[]> {
  // `tiff` is an optionalDependency (issue #140 decision 3): externalized in the
  // tsup build and lazy-imported here so it resolves from the consumer's install
  // at runtime (skia-canvas pattern) and never lands in bundles that don't read
  // TIFFs. A missing package surfaces the actionable error below.
  let mod: { decode: (b: Uint8Array, o?: unknown) => TiffIfdLike[] };
  try {
    mod = (await import("tiff")) as unknown as typeof mod;
  } catch {
    throw new Error(
      "Reading TIFF label images requires the optional `tiff` package. " +
        "Install it with: npm install tiff",
    );
  }
  try {
    return mod.decode(bytes, opts);
  } catch (err) {
    // `tiff` throws "Unsupported bitDepth: 32" for 32/64-bit INTEGER rasters.
    // Surface a clear, actionable message (also caught proactively in
    // validatePageDtype when headers are readable).
    const m = String((err as Error)?.message ?? "");
    if (/bit\s*depth/i.test(m) && /(32|64)/.test(m)) {
      throw new Error(
        `32-bit integer TIFFs are not yet supported (${m}). Re-export the label ` +
          "image as uint16, or split into <=65535 objects.",
      );
    }
    throw err;
  }
}

/**
 * Load dense integer label images from a TIFF file (or a directory of TIFFs on
 * Node). Mirrors Python `read_label_images`.
 *
 * @param source Node: a path string (file or directory). Browser: a `File`/`Blob`.
 * @returns One `UserLabelImage` per page in `time`/`auto`(→time) mode, or a
 *   single-element array in `classes` mode.
 */
export async function loadLabelImages(
  source: string | File | Blob,
  options: LoadLabelImagesOptions = {},
): Promise<UserLabelImage[]> {
  const pagesAs: PagesAs = options.pagesAs ?? "auto";
  if (pagesAs !== "auto" && pagesAs !== "time" && pagesAs !== "classes") {
    throw new Error(
      `pagesAs must be 'auto', 'time', or 'classes'; got ${JSON.stringify(pagesAs)}.`,
    );
  }

  const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
  if (isBlob) {
    const bytes = new Uint8Array(await (source as Blob).arrayBuffer());
    const src = options.source ?? (source as File).name ?? "";
    return decodeSingleFile(bytes, pagesAs, options, src);
  }

  if (!fileReader) {
    throw new Error(
      "Reading TIFF label images from a path requires the Node entry point " +
        "(`@talmolab/sleap-io.js`). In the browser, pass a File/Blob instead.",
    );
  }
  const read = await fileReader(source as string);
  const src = options.source ?? (source as string);
  if (read instanceof Uint8Array) {
    return decodeSingleFile(read, pagesAs, options, src);
  }
  return decodeDirectory(read.files, pagesAs, options, src);
}

/** Decode a single multi-page TIFF buffer. */
async function decodeSingleFile(
  bytes: Uint8Array,
  pagesAs: PagesAs,
  options: LoadLabelImagesOptions,
  source: string,
): Promise<UserLabelImage[]> {
  // Cheap header scan: validate dtype, count pages, read page-0 metadata.
  const meta = await decodeTiff(bytes, { ignoreImageData: true });
  const nPages = meta.length;
  if (nPages === 0) return [];
  for (const ifd of meta) validatePageDtype(ifd);

  // Resolve layout (priority: explicit pagesAs -> tag-270 metadata -> fallback).
  let layout: Layout;
  if (pagesAs === "time") layout = "TYX";
  else if (pagesAs === "classes") layout = "CYX";
  else layout = inferAxes(meta[0].imageDescription, nPages);

  if (layout === "TCYX") {
    throw new Error(
      "4D TCYX (time + channel) TIFF stacks are not yet supported. Pass " +
        "pagesAs: 'time' or 'classes' explicitly, or split the stack by channel.",
    );
  }

  // Page subset (0-based). Free via the decoder's `pages` option.
  const pageIndices = normalizeFrames(options.frames, nPages);
  if (pageIndices.length === 0) return [];

  const ifds = await decodeTiff(bytes, { pages: pageIndices });
  const pages = ifds.map(pageTo2D);

  if (layout === "CYX") {
    return [buildClassStack(pages, options, source)];
  }

  // YX / TYX / unknown -> time.
  if (
    pagesAs === "auto" &&
    layout === "unknown" &&
    nPages > 1 &&
    pagesCouldBeClassStack(pages)
  ) {
    warnAmbiguous(source, nPages, dtypeName(meta[0]));
  }
  return buildTimeStack(pages, options, source);
}

/** Decode a directory of single-frame TIFFs (Node only). One file per frame. */
async function decodeDirectory(
  files: Uint8Array[],
  pagesAs: PagesAs,
  options: LoadLabelImagesOptions,
  source: string,
): Promise<UserLabelImage[]> {
  if (files.length === 0) return [];
  const fileIndices = normalizeFrames(options.frames, files.length);
  const pages: number[][][] = [];
  for (const i of fileIndices) {
    const ifds = await decodeTiff(files[i], { pages: [0] });
    if (ifds.length === 0) continue;
    validatePageDtype(ifds[0]);
    pages.push(pageTo2D(ifds[0]));
  }
  if (pages.length === 0) return [];
  // Directories never inspect metadata and never emit the ambiguous warning.
  if (pagesAs === "classes") return [buildClassStack(pages, options, source)];
  return buildTimeStack(pages, options, source);
}

// --- dtype / geometry validation -------------------------------------------

function validatePageDtype(ifd: TiffIfdLike): void {
  if (ifd.samplesPerPixel !== 1) {
    throw new Error(
      `Expected a single-channel (2D) label-image page, got ${ifd.samplesPerPixel} ` +
        "samples per pixel. Multi-channel/RGB TIFFs are not supported.",
    );
  }
  // MVP supports only unsigned 8/16-bit label rasters. Float, signed, and 32-bit
  // integer are deferred (issue #140) and rejected with a clear, actionable error
  // rather than silently truncated.
  const fmt = ifd.sampleFormat ?? 1; // 1=uint, 2=int, 3=float
  if (fmt === 3) {
    throw new Error(
      `Floating-point TIFFs are not supported as label images (bitsPerSample=${ifd.bitsPerSample}). ` +
        "Re-export as uint8 or uint16.",
    );
  }
  if (fmt === 2) {
    throw new Error(
      "Signed-integer TIFFs are not supported as label images. Re-export as uint8 or uint16.",
    );
  }
  if (ifd.bitsPerSample !== 8 && ifd.bitsPerSample !== 16) {
    throw new Error(
      `Only 8- and 16-bit unsigned label images are supported (got ${ifd.bitsPerSample}-bit). ` +
        "Re-export as uint16, or split into <=65535 objects.",
    );
  }
}

function dtypeName(ifd: TiffIfdLike): string {
  const fmt = ifd.sampleFormat ?? 1;
  const kind = fmt === 3 ? "float" : fmt === 2 ? "int" : "uint";
  return `${kind}${ifd.bitsPerSample}`;
}

// --- axis inference from tag-270 metadata ----------------------------------

/**
 * Infer the page layout from the page-0 `ImageDescription` (tag 270). Only
 * ImageJ-hyperstack and OME-XML metadata are authoritative; a plain multi-page
 * TIFF reports `"unknown"`. A single page is always `"YX"`.
 */
export function inferAxes(
  description: string | undefined,
  nPages: number,
): Layout {
  if (nPages === 1) return "YX";
  if (!description) return "unknown";

  const dims = parseImageJDims(description) ?? parseOmeDims(description);
  if (!dims) return "unknown";
  return dimsToLayout(dims.c, dims.z, dims.t);
}

function dimsToLayout(c: number, z: number, t: number): Layout {
  const time = Math.max(z, 1) * Math.max(t, 1);
  if (c > 1 && time <= 1) return "CYX";
  if (c <= 1 && time > 1) return "TYX";
  if (c > 1 && time > 1) return "TCYX";
  return "unknown";
}

/** Parse ImageJ-hyperstack `key=value` ImageDescription. */
function parseImageJDims(
  desc: string,
): { c: number; z: number; t: number } | null {
  if (!/(^|\n)ImageJ=/.test(desc)) return null;
  const get = (key: string): number => {
    const m = desc.match(new RegExp(`(?:^|\\n)${key}=(\\d+)`));
    return m ? parseInt(m[1], 10) : 1;
  };
  return { c: get("channels"), z: get("slices"), t: get("frames") };
}

/** Parse OME-XML `<Pixels SizeC/SizeT/SizeZ=...>` ImageDescription. */
function parseOmeDims(
  desc: string,
): { c: number; z: number; t: number } | null {
  if (!/<\s*OME[\s>]|openmicroscopy\.org/i.test(desc)) return null;
  const pixels = desc.match(/<\s*Pixels\b[^>]*>/i);
  const attrs = pixels ? pixels[0] : desc;
  const get = (attr: string): number => {
    const m = attrs.match(new RegExp(`${attr}\\s*=\\s*["'](\\d+)["']`, "i"));
    return m ? parseInt(m[1], 10) : 1;
  };
  return { c: get("SizeC"), z: get("SizeZ"), t: get("SizeT") };
}

// --- label-ID inference (classes mode) -------------------------------------

/**
 * If every page is a single-class binary (exactly one distinct positive value)
 * and those per-page values are all distinct, return them (COCO-style ID
 * preservation). Otherwise return `null` (positional `1..N`). Mirrors Python
 * `_infer_label_ids_from_pages`.
 */
export function inferLabelIdsFromPages(pages: number[][][]): number[] | null {
  const ids: number[] = [];
  for (const page of pages) {
    const positive = new Set<number>();
    for (const row of page) {
      for (const v of row) {
        if (v > 0) {
          positive.add(v);
          if (positive.size > 1) return null;
        }
      }
    }
    if (positive.size !== 1) return null;
    ids.push(positive.values().next().value as number);
  }
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

/** True unless any page has >=2 distinct positive values (Python `_pages_could_be_class_stack`). */
function pagesCouldBeClassStack(pages: number[][][]): boolean {
  for (const page of pages) {
    const positive = new Set<number>();
    for (const row of page) {
      for (const v of row) {
        if (v > 0) {
          positive.add(v);
          if (positive.size >= 2) return false;
        }
      }
    }
  }
  return true;
}

// --- builders ---------------------------------------------------------------

function buildTimeStack(
  pages: number[][][],
  options: LoadLabelImagesOptions,
  source: string,
): UserLabelImage[] {
  return LabelImage.fromStack({
    data: pages,
    tracks: options.tracks ?? null,
    categories: options.categories ?? null,
    createTracks: options.createTracks ?? false,
    source,
  });
}

function buildClassStack(
  pages: number[][][],
  options: LoadLabelImagesOptions,
  source: string,
): UserLabelImage {
  const labelIds = inferLabelIdsFromPages(pages);
  const masks = pages.map((page) =>
    page.map((row) => row.map((v) => (v > 0 ? 1 : 0))),
  );
  const categories = coerceCategoriesToList(options.categories, pages.length);
  return LabelImage.fromBinaryMasks(masks, {
    labelIds: labelIds ?? undefined,
    categories: categories ?? undefined,
    source,
  });
}

/** Coerce categories to a positional list of length `n`, or `null` if all empty. */
function coerceCategoriesToList(
  categories: Map<number, string> | string[] | null | undefined,
  n: number,
): string[] | null {
  if (categories == null) return null;
  let list: string[];
  if (Array.isArray(categories)) {
    list = Array.from({ length: n }, (_, i) => categories[i] ?? "");
  } else {
    // Class-mode categories key by POSITIONAL post-composite IDs 1..N, NOT the
    // preserved COCO label IDs (Python `_categories_as_list` parity).
    list = Array.from({ length: n }, (_, i) => categories.get(i + 1) ?? "");
  }
  return list.some((c) => c !== "") ? list : null;
}

// --- helpers ----------------------------------------------------------------

function normalizeFrames(
  frames: number[] | null | undefined,
  n: number,
): number[] {
  if (frames == null) return Array.from({ length: n }, (_, i) => i);
  return frames.filter((i) => i >= 0 && i < n);
}

/** Convert a decoded IFD's flat (uint8/uint16) sample array to a 2D `number[][]`. */
function pageTo2D(ifd: TiffIfdLike): number[][] {
  const { width, height, data } = ifd;
  const out: number[][] = new Array(height);
  for (let r = 0; r < height; r++) {
    const row = new Array<number>(width);
    for (let c = 0; c < width; c++) row[c] = data[r * width + c];
    out[r] = row;
  }
  return out;
}

function warnAmbiguous(path: string, nPages: number, dtype: string): void {
  const msg =
    `Loaded ${nPages} frames from multi-page TIFF ${path} with no axis metadata ` +
    `(dtype=${dtype}). Assuming pages are time. If pages represent classes for a ` +
    `single frame, pass pagesAs: 'classes' to route through fromBinaryMasks with categories.`;
  if (warnedMessages.has(msg)) return;
  warnedMessages.add(msg);
  console.warn(msg);
}
