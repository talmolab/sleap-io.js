/**
 * Parsers for the SLP mask, ROI and label-image tables, shared by the eager /
 * lazy reader (`read.ts`, over h5wasm) and the streaming reader
 * (`read-streaming.ts`, over prefetched worker reads), so both build the same
 * annotations from the same bytes. Browser-safe: no h5wasm or Node imports.
 *
 * Also holds the per-detection identity / category attach helpers (SLP 2.5 /
 * 2.7), which both readers apply to the parsed detection lists.
 */
import type {
  Instance,
  PredictedInstance,
  Track,
} from "../../model/instance.js";
import type { Identity } from "../../model/identity.js";
import type { Embedding } from "../../model/embedding.js";
import type { Video } from "../../model/video.js";
import {
  type ROI,
  UserROI,
  PredictedROI,
  AnnotationType,
  decodeWkb,
} from "../../model/roi.js";
import {
  type SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
} from "../../model/mask.js";
import {
  type BoundingBox,
  UserBoundingBox,
  PredictedBoundingBox,
} from "../../model/bbox.js";
import {
  type LabelImage,
  type LabelImageObjectInfo,
  UserLabelImage,
  PredictedLabelImage,
} from "../../model/label-image.js";
import { inflate } from "pako";

/**
 * Synchronous read access to the annotation datasets an SLP file holds,
 * implemented over an open h5wasm file (eager / lazy reader) or over data the
 * streaming reader prefetched from its worker.
 */
export interface AnnotationDatasets {
  /** A struct table (compound or flat-2D + `field_names`) as columns; `null` when absent. */
  struct(path: string): Record<string, any[]> | null;
  /** A raw byte dataset (WKB, RLE, compressed blobs); `null` when absent. */
  bytes(path: string): Uint8Array | null;
  /**
   * A per-annotation string list: the root-level `rootPath` dataset (native
   * vlen strings, or the older JSON-in-bytes layout with its `json` attr), else
   * the JSON `attrName` attribute on the `structPath` table (pre-1.9 files).
   */
  strings(rootPath: string, structPath: string, attrName: string): string[];
  /** A dataset's value and shape as stored (e.g. 3-D `label_image_data`); `null` when absent. */
  raw(path: string): { value: any; shape: number[] } | null;
}

/** Struct tables the parsers read (for prefetching). */
export const ANNOTATION_STRUCT_PATHS = [
  "rois",
  "masks",
  "mask_score_map_index",
  "label_images",
  "label_image_objects",
  "label_image_score_map_index",
] as const;

/** Raw byte datasets the parsers read (for prefetching). */
export const ANNOTATION_BYTES_PATHS = [
  "roi_wkb",
  "mask_rle",
  "mask_score_maps",
  "label_image_score_maps",
] as const;

/** Per-annotation string lists: root dataset → [struct table, legacy attr]. */
export const ANNOTATION_STRING_LISTS: ReadonlyArray<
  readonly [string, string, string]
> = [
  ["roi_categories", "rois", "categories"],
  ["roi_names", "rois", "names"],
  ["roi_sources", "rois", "sources"],
  ["mask_categories", "masks", "categories"],
  ["mask_names", "masks", "names"],
  ["mask_sources", "masks", "sources"],
  ["label_image_sources", "label_images", "sources"],
  ["label_image_obj_categories", "label_image_objects", "categories"],
  ["label_image_obj_names", "label_image_objects", "names"],
];

/** Parse a JSON string list (string or UTF-8 bytes); `null` if it isn't one. */
export function parseJsonStringList(raw: unknown): string[] | null {
  const v = (raw as { value?: unknown } | null)?.value ?? raw;
  const text =
    typeof v === "string"
      ? v
      : v instanceof Uint8Array
        ? new TextDecoder().decode(v)
        : null;
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? "")) : null;
  } catch {
    return null;
  }
}

/**
 * Decode a root string-list dataset's value: native vlen strings (an array of
 * strings or UTF-8 byte arrays), or the older JSON-in-`<B`-bytes layout.
 */
export function decodeStringListValue(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    // Old layout read back as a plain number array: JSON bytes.
    if (value.length && value.every((x) => typeof x === "number")) {
      return parseJsonStringList(Uint8Array.from(value as number[])) ?? [];
    }
    return value.map((x) =>
      typeof x === "string"
        ? x
        : x instanceof Uint8Array
          ? new TextDecoder().decode(x)
          : String(x ?? ""),
    );
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    return parseJsonStringList(bytes) ?? [];
  }
  return parseJsonStringList(value) ?? [];
}

/** A detection that can carry a per-detection identity/embedding (SLP 2.5). */
export interface IdentityBearingRead {
  identity?: Identity | null;
  identityScore?: number | null;
  identityEmbedding?: Embedding | null;
  category?: string | null;
  categoryScore?: number | null;
  categoryEmbedding?: Embedding | null;
}

/**
 * Attach per-detection identity + score + embedding onto a modality's ordered
 * detection list (index == `owner_id`), from the `/identity/links` + `/embeddings`
 * maps for one owner type. Mutates the detection objects in place.
 */
export function attachIdentityToOwners(
  owners: IdentityBearingRead[],
  identities: Identity[],
  links: Map<number, [number, number | null]> | undefined,
  embs: Map<number, Embedding> | undefined,
): void {
  if (links) {
    for (const [ownerId, [idx, score]] of links) {
      const det = owners[ownerId];
      if (det && idx >= 0 && idx < identities.length) {
        det.identity = identities[idx];
        det.identityScore = score;
      }
    }
  }
  if (embs) {
    for (const [ownerId, emb] of embs) {
      const det = owners[ownerId];
      if (det) det.identityEmbedding = emb;
    }
  }
}

/**
 * Attach per-detection category (string) + score + embedding onto a modality's
 * ordered detection list (index == `owner_id`), from the `/categories` catalog +
 * `/categories/links` + category embeddings for one owner type.
 */
export function attachCategoryToOwners(
  owners: IdentityBearingRead[],
  catalog: string[],
  links: Map<number, [number, number | null]> | undefined,
  embs: Map<number, Embedding> | undefined,
): void {
  if (links) {
    for (const [ownerId, [idx, score]] of links) {
      const det = owners[ownerId];
      if (det && idx >= 0 && idx < catalog.length) {
        det.category = catalog[idx];
        det.categoryScore = score;
      }
    }
  }
  if (embs) {
    for (const [ownerId, emb] of embs) {
      const det = owners[ownerId];
      if (det) det.categoryEmbedding = emb;
    }
  }
}

/** All per-detection identity (SLP 2.5) + category (SLP 2.7) join maps + the
 * category catalog, read once. Empty maps on pre-2.5/2.7 files. */
export interface PerDetectionMaps {
  idLinks: Map<number, Map<number, [number, number | null]>>;
  idEmbs: Map<number, Map<number, Embedding>>;
  catLinks: Map<number, Map<number, [number, number | null]>>;
  catEmbs: Map<number, Map<number, Embedding>>;
  categoryCatalog: string[];
}

/** Attach identity + category for one owner type onto its ordered detection list. */
export function attachOwnerType(
  maps: PerDetectionMaps,
  ownerType: number,
  owners: IdentityBearingRead[],
  identities: Identity[],
): void {
  attachIdentityToOwners(
    owners,
    identities,
    maps.idLinks.get(ownerType),
    maps.idEmbs.get(ownerType),
  );
  attachCategoryToOwners(
    owners,
    maps.categoryCatalog,
    maps.catLinks.get(ownerType),
    maps.catEmbs.get(ownerType),
  );
}

export function readRoiTuples(
  src: AnnotationDatasets,
  videos: Video[],
  tracks: Track[],
  instances?: Array<Instance | PredictedInstance>,
): {
  rois: [ROI, number, number][];
  migratedBboxes: [BoundingBox, number, number][];
} {
  const roisData = src.struct("rois");
  if (!roisData) return { rois: [], migratedBboxes: [] };
  const annotationTypes = roisData.annotation_type ?? [];
  if (!annotationTypes.length) return { rois: [], migratedBboxes: [] };

  const wkbFlat = src.bytes("roi_wkb");
  if (!wkbFlat) return { rois: [], migratedBboxes: [] };

  // v1.9+: string datasets; fallback to JSON attrs
  const categories = src.strings("roi_categories", "rois", "categories");
  const names = src.strings("roi_names", "rois", "names");
  const sources = src.strings("roi_sources", "rois", "sources");

  const videoIndices = roisData.video ?? [];
  const frameIndices = roisData.frame_idx ?? [];
  const trackIndices = roisData.track ?? [];
  const scores = roisData.score ?? [];
  const wkbStarts = roisData.wkb_start ?? [];
  const wkbEnds = roisData.wkb_end ?? [];
  const instanceIndices = roisData.instance ?? [];
  // v1.9+ column (may not exist in older files)
  const isPredictedCol = roisData.is_predicted ?? [];
  const trackingScoresCol = roisData.tracking_score ?? [];

  const rois: [ROI, number, number][] = [];
  const migratedBboxes: [BoundingBox, number, number][] = [];

  for (let i = 0; i < annotationTypes.length; i++) {
    const wkbStart = Number(wkbStarts[i]);
    const wkbEnd = Number(wkbEnds[i]);
    const wkbBytes = wkbFlat.slice(wkbStart, wkbEnd);
    const geometry = decodeWkb(wkbBytes);

    const videoIdx = Number(videoIndices[i]);
    const video =
      videoIdx >= 0 && videoIdx < videos.length ? videos[videoIdx] : null;

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const annotType = Number(annotationTypes[i]);

    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    const roiTsVal =
      trackingScoresCol.length > i ? Number(trackingScoresCol[i]) : Number.NaN;
    const roiTrackingScore = Number.isNaN(roiTsVal) ? null : roiTsVal;

    // Migration: annotation_type === 1 (BOUNDING_BOX) -> BoundingBox object
    // Skip predicted ROIs during bbox migration (only migrate user-type box-shaped ROIs)
    if (annotType === AnnotationType.BOUNDING_BOX && !isPred) {
      const tmpRoi = new UserROI({
        geometry,
        name: names[i] ?? "",
        category: categories[i] ?? "",
        source: sources[i] ?? "",
        video,
        track,
      });
      const b = tmpRoi.bounds;
      const scoreVal = Number(scores[i]);
      const bboxScore = Number.isNaN(scoreVal) ? null : scoreVal;

      const bboxOptions = {
        x1: b.minX,
        y1: b.minY,
        x2: b.maxX,
        y2: b.maxY,
        track,
        trackingScore: roiTrackingScore,
        category: categories[i] ?? "",
        name: names[i] ?? "",
        source: sources[i] ?? "",
      };

      let bbox: BoundingBox;
      if (bboxScore !== null) {
        bbox = new PredictedBoundingBox({ ...bboxOptions, score: bboxScore });
      } else {
        bbox = new UserBoundingBox(bboxOptions);
      }

      // Format >= 1.6: resolve instance references for migrated bboxes
      if (instanceIndices.length > 0) {
        const instIdx = Number(instanceIndices[i]);
        if (instances && instIdx >= 0 && instIdx < instances.length) {
          bbox.instance = instances[instIdx];
        } else if (instIdx >= 0) {
          bbox._instanceIdx = instIdx;
        }
      }

      migratedBboxes.push([bbox, videoIdx, frameIdxVal]);
    } else {
      const roiOptions = {
        geometry,
        name: names[i] ?? "",
        category: categories[i] ?? "",
        source: sources[i] ?? "",
        video,
        track,
        trackingScore: roiTrackingScore,
      };

      let roi: ROI;
      if (isPred) {
        const scoreVal = Number(scores[i]);
        roi = new PredictedROI({
          ...roiOptions,
          score: Number.isNaN(scoreVal) ? 0 : scoreVal,
        });
      } else {
        roi = new UserROI(roiOptions);
      }

      // Format >= 1.6: resolve instance references
      if (instanceIndices.length > 0) {
        const instIdx = Number(instanceIndices[i]);
        if (instances && instIdx >= 0 && instIdx < instances.length) {
          roi.instance = instances[instIdx];
        } else if (instIdx >= 0) {
          roi._instanceIdx = instIdx;
        }
      }

      rois.push([roi, videoIdx, frameIdxVal]);
    }
  }

  return { rois, migratedBboxes };
}

/**
 * Read score maps from index + data datasets.
 * Returns a Map from annotation index to { scoreMap, height, width }.
 */
function readScoreMaps(
  src: AnnotationDatasets,
  indexPath: string,
  dataPath: string,
): Map<number, { scoreMap: Float32Array; height: number; width: number }> {
  const result = new Map<
    number,
    { scoreMap: Float32Array; height: number; width: number }
  >();
  const indexData = src.struct(indexPath);
  const dataFlat = src.bytes(dataPath);
  if (!indexData || !dataFlat) return result;

  const idxCol = indexData.mask_idx ?? indexData.li_idx ?? [];
  const starts = indexData.data_start ?? [];
  const ends = indexData.data_end ?? [];
  const smHeights = indexData.height ?? [];
  const smWidths = indexData.width ?? [];

  for (let i = 0; i < idxCol.length; i++) {
    const annotIdx = Number(idxCol[i]);
    const start = Number(starts[i]);
    const end = Number(ends[i]);
    const h = Number(smHeights[i]);
    const w = Number(smWidths[i]);

    const compressed = dataFlat.slice(start, end);
    const decompressed = inflate(compressed);
    const expectedBytes = h * w * 4; // Float32 = 4 bytes per element
    if (decompressed.byteLength !== expectedBytes) {
      throw new Error(
        `Score map decompression size mismatch: expected ${expectedBytes} bytes, got ${decompressed.byteLength}`,
      );
    }
    const scoreMap = new Float32Array(
      decompressed.buffer.slice(
        decompressed.byteOffset,
        decompressed.byteOffset + decompressed.byteLength,
      ),
    );

    result.set(annotIdx, { scoreMap, height: h, width: w });
  }
  return result;
}

export function readMaskTuples(
  src: AnnotationDatasets,
  tracks: Track[],
): [SegmentationMask, number, number][] {
  const masksData = src.struct("masks");
  if (!masksData) return [];
  const heights = masksData.height ?? [];
  if (!heights.length) return [];

  const rleFlat = src.bytes("mask_rle");
  if (!rleFlat) return [];

  // v1.9+: string datasets at root level; fallback to JSON attrs on mask dataset
  const categories = src.strings("mask_categories", "masks", "categories");
  const names = src.strings("mask_names", "masks", "names");
  const sources = src.strings("mask_sources", "masks", "sources");

  const widths = masksData.width ?? [];
  const videoIndices = masksData.video ?? [];
  const frameIndices = masksData.frame_idx ?? [];
  const trackIndices = masksData.track ?? [];
  const rleStarts = masksData.rle_start ?? [];
  const rleEnds = masksData.rle_end ?? [];
  // v1.9+ columns (may not exist in older files)
  const isPredictedCol = masksData.is_predicted ?? [];
  const scoreCol = masksData.score ?? [];
  const instanceCol = masksData.instance ?? [];
  const maskTrackingScoreCol = masksData.tracking_score ?? [];
  // v2.4+: from_predicted provenance index into the flat mask list. Absent in
  // pre-2.4 files (presence-gated by name) -> [] -> per-row fallback -1.
  const fromPredictedCol = masksData.from_predicted ?? [];

  // v2.1+: spatial metadata columns (default to 1.0/0.0 for old files)
  const scaleXCol = masksData.scale_x ?? [];
  const scaleYCol = masksData.scale_y ?? [];
  const offsetXCol = masksData.offset_x ?? [];
  const offsetYCol = masksData.offset_y ?? [];

  // Read score maps if present
  const scoreMaps = readScoreMaps(
    src,
    "mask_score_map_index",
    "mask_score_maps",
  );

  const masks: [SegmentationMask, number, number][] = [];
  // Deferred from_predicted re-link: collect (userMaskIdx, srcIdx) pairs and
  // resolve after ALL masks are built, since a source prediction can appear
  // later in the flat list (mirrors instance from_predicted).
  const fromPredictedPairs: Array<[number, number]> = [];
  for (let i = 0; i < heights.length; i++) {
    const rleStart = Number(rleStarts[i]);
    const rleEnd = Number(rleEnds[i]);
    const rleRaw = rleFlat.slice(rleStart, rleEnd);

    // Convert packed uint8 bytes back to Uint32Array (4 bytes per count, little-endian)
    const numCounts = rleRaw.byteLength / 4;
    const rleCounts = new Uint32Array(numCounts);
    const rleView = new DataView(
      rleRaw.buffer,
      rleRaw.byteOffset,
      rleRaw.byteLength,
    );
    for (let j = 0; j < numCounts; j++) {
      rleCounts[j] = rleView.getUint32(j * 4, true);
    }

    const videoIdx = Number(videoIndices[i]);

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const scaleX = scaleXCol.length > i ? Number(scaleXCol[i]) : 1;
    const scaleY = scaleYCol.length > i ? Number(scaleYCol[i]) : 1;
    const offsetX = offsetXCol.length > i ? Number(offsetXCol[i]) : 0;
    const offsetY = offsetYCol.length > i ? Number(offsetYCol[i]) : 0;

    const maskTsVal =
      maskTrackingScoreCol.length > i
        ? Number(maskTrackingScoreCol[i])
        : Number.NaN;
    const maskTrackingScore = Number.isNaN(maskTsVal) ? null : maskTsVal;

    const baseOptions = {
      rleCounts,
      height: Number(heights[i]),
      width: Number(widths[i]),
      name: names[i] ?? "",
      category: categories[i] ?? "",
      source: sources[i] ?? "",
      track,
      trackingScore: maskTrackingScore,
      scale: [scaleX, scaleY] as [number, number],
      offset: [offsetX, offsetY] as [number, number],
    };

    // Determine if predicted based on is_predicted column or NaN score fallback
    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;
    let mask: SegmentationMask;

    if (isPred) {
      const scoreVal = scoreCol.length > i ? Number(scoreCol[i]) : 0;
      const sm = scoreMaps.get(i);
      mask = new PredictedSegmentationMask({
        ...baseOptions,
        score: scoreVal,
        scoreMap: sm?.scoreMap ?? null,
      });
    } else {
      mask = new UserSegmentationMask(baseOptions);
      // Collect from_predicted link for deferred re-link (user masks only).
      const fpIdx =
        fromPredictedCol.length > i ? Number(fromPredictedCol[i]) : -1;
      if (fpIdx >= 0) fromPredictedPairs.push([i, fpIdx]);
    }

    // Resolve instance reference
    const instIdx = instanceCol.length > i ? Number(instanceCol[i]) : -1;
    if (instIdx >= 0) {
      mask._instanceIdx = instIdx;
    }

    masks.push([mask, videoIdx, frameIdxVal]);
  }

  // Deferred from_predicted re-link pass. Bounds-checked so out-of-range or -1
  // indices leave fromPredicted at its constructor default (null).
  for (const [i, fpIdx] of fromPredictedPairs) {
    if (fpIdx >= 0 && fpIdx < masks.length) {
      (masks[i][0] as UserSegmentationMask).fromPredicted = masks[
        fpIdx
      ][0] as PredictedSegmentationMask;
    }
  }

  return masks;
}

// Pixel data is eagerly materialized into a standalone Int32Array per
// LabelImage; the h5wasm File is closed by readSlp's finally block before
// Labels is returned. label-image .data therefore has no dependency on the
// source file lifetime — the Python issue addressed by PR #419 (h5py
// Dataset closure invalidated by Labels.__del__) does not apply here.
export function readLabelImageTuples(
  src: AnnotationDatasets,
  tracks: Track[],
  instances?: Array<Instance | PredictedInstance>,
): [LabelImage, number, number][] {
  const liData = src.struct("label_images");
  if (!liData) return [];
  const videoIndices = liData.video ?? [];
  if (!videoIndices.length) return [];

  const frameIndices = liData.frame_idx ?? [];
  const heights = liData.height ?? [];
  const widths = liData.width ?? [];
  const nObjectsList = liData.n_objects ?? [];
  const objectsStarts = liData.objects_start ?? [];
  const dataStarts = liData.data_start ?? [];
  const dataEnds = liData.data_end ?? [];

  // v1.9+: string datasets; fallback to JSON attrs
  const sources = src.strings("label_image_sources", "label_images", "sources");

  // v1.9+ columns (may not exist in older files)
  const isPredictedCol = liData.is_predicted ?? [];
  const liScoreCol = liData.score ?? [];

  // v2.1+: spatial metadata columns (default to 1.0/0.0 for old files)
  const liScaleXCol = liData.scale_x ?? [];
  const liScaleYCol = liData.scale_y ?? [];
  const liOffsetXCol = liData.offset_x ?? [];
  const liOffsetYCol = liData.offset_y ?? [];

  // Read pixel data: either blob (1D, v1.8-v2.1) or chunked (3D, v2.2+)
  const dataDs = src.raw("label_image_data");
  if (!dataDs) return [];
  const dataShape = dataDs.shape ?? [];
  const isChunked = dataShape.length === 3;
  // For blob format: flat Uint8Array of concatenated zlib-compressed frames
  // For chunked format: 3D Int32Array [T, H, W] (decompression handled by HDF5 lib)
  let dataFlat: Uint8Array = new Uint8Array(0);
  let dataChunked: any = null;
  if (isChunked) {
    dataChunked = dataDs.value; // 3D array or flat typed array with shape metadata
  } else {
    dataFlat =
      dataDs.value instanceof Uint8Array
        ? dataDs.value
        : new Uint8Array(dataDs.value ?? []);
  }

  // Read objects table (may not exist if all label images have 0 objects)
  let objLabelIds: any[] = [];
  let objTrackIndices: any[] = [];
  let objInstanceIndices: any[] = [];
  let objCategories: string[] = [];
  let objNames: string[] = [];
  let objScoreCol: any[] = [];
  let objTrackingScoreCol: any[] = [];

  const objData = src.struct("label_image_objects");
  if (objData) {
    objLabelIds = objData.label_id ?? [];
    objTrackIndices = objData.track ?? [];
    objInstanceIndices = objData.instance ?? [];
    // v1.9+: string datasets at root level
    objCategories = src.strings(
      "label_image_obj_categories",
      "label_image_objects",
      "categories",
    );
    objNames = src.strings(
      "label_image_obj_names",
      "label_image_objects",
      "names",
    );
    objScoreCol = objData.score ?? [];
    objTrackingScoreCol = objData.tracking_score ?? [];
  }

  // Read score maps if present
  const liScoreMaps = readScoreMaps(
    src,
    "label_image_score_map_index",
    "label_image_score_maps",
  );

  const labelImages: [LabelImage, number, number][] = [];
  for (let i = 0; i < videoIndices.length; i++) {
    const videoIdx = Number(videoIndices[i]);
    const frameIdxVal = Number(frameIndices[i]);
    const height = Number(heights[i]);
    const width = Number(widths[i]);

    // Extract pixel data from blob or chunked format
    let pixelData: Int32Array;
    if (isChunked && dataChunked) {
      // v2.2+: 3D chunked dataset [T, H, W] — frames stored sequentially by the
      // Python writer, so loop index i maps directly to the i-th frame slice.
      const frameSize = height * width;
      if (dataChunked instanceof Int32Array) {
        // Flat typed array with shape [T, H, W] — slice by frame index
        pixelData = new Int32Array(
          dataChunked.buffer,
          dataChunked.byteOffset + i * frameSize * 4,
          frameSize,
        );
      } else if (ArrayBuffer.isView(dataChunked)) {
        // Other typed array — convert to Int32Array
        const offset = i * frameSize;
        pixelData = new Int32Array(frameSize);
        for (let p = 0; p < frameSize; p++) {
          pixelData[p] = (dataChunked as any)[offset + p];
        }
      } else {
        // Fallback: array of arrays or similar
        pixelData = new Int32Array(frameSize);
      }
    } else {
      // v1.8-v2.1: blob format — decompress from flat byte array
      const dataStart = Number(dataStarts[i]);
      const dataEnd = Number(dataEnds[i]);
      const compressed = dataFlat.slice(dataStart, dataEnd);
      const decompressed = inflate(compressed);
      // Convert bytes back to Int32Array (little-endian, matches native).
      // Use buffer.slice() to guarantee 4-byte alignment for Int32Array.
      pixelData = new Int32Array(
        decompressed.buffer.slice(
          decompressed.byteOffset,
          decompressed.byteOffset + decompressed.byteLength,
        ),
      );
    }

    // Build objects map
    const nObj = Number(nObjectsList[i]);
    const objStart = Number(objectsStarts[i]);
    const objects = new Map<number, LabelImageObjectInfo>();
    const deferredInstances = new Map<number, number>();

    for (let j = objStart; j < objStart + nObj; j++) {
      const labelId = Number(objLabelIds[j]);
      const trackIdx = Number(objTrackIndices[j]);
      const track =
        trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;
      const instIdx = Number(objInstanceIndices[j]);
      let instance: Instance | null = null;

      if (instances && instIdx >= 0 && instIdx < instances.length) {
        instance = instances[instIdx] as Instance;
      } else if (instIdx >= 0) {
        deferredInstances.set(labelId, instIdx);
      }

      const objScore = objScoreCol.length > j ? Number(objScoreCol[j]) : null;
      const objTsVal =
        objTrackingScoreCol.length > j ? Number(objTrackingScoreCol[j]) : null;

      objects.set(labelId, {
        track,
        category: objCategories[j] ?? "",
        name: objNames[j] ?? "",
        instance,
        score: objScore !== null && !Number.isNaN(objScore) ? objScore : null,
        trackingScore:
          objTsVal !== null && !Number.isNaN(objTsVal) ? objTsVal : null,
        _instanceIdx: instIdx >= 0 ? instIdx : -1,
      });
    }

    // Determine if predicted
    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    // v2.1+: spatial metadata
    const liScaleX = liScaleXCol.length > i ? Number(liScaleXCol[i]) : 1;
    const liScaleY = liScaleYCol.length > i ? Number(liScaleYCol[i]) : 1;
    const liOffsetX = liOffsetXCol.length > i ? Number(liOffsetXCol[i]) : 0;
    const liOffsetY = liOffsetYCol.length > i ? Number(liOffsetYCol[i]) : 0;
    const liScale: [number, number] = [liScaleX, liScaleY];
    const liOffset: [number, number] = [liOffsetX, liOffsetY];

    let li: LabelImage;
    if (isPred) {
      const liScore = liScoreCol.length > i ? Number(liScoreCol[i]) : 0;
      const sm = liScoreMaps.get(i);
      li = new PredictedLabelImage({
        data: pixelData,
        height,
        width,
        objects,
        source: sources[i] ?? "",
        score: liScore,
        scoreMap: sm?.scoreMap ?? null,
        scale: liScale,
        offset: liOffset,
      });
    } else {
      li = new UserLabelImage({
        data: pixelData,
        height,
        width,
        objects,
        source: sources[i] ?? "",
        scale: liScale,
        offset: liOffset,
      });
    }

    if (deferredInstances.size > 0) {
      li._objectInstanceIdxs = deferredInstances;
    }

    labelImages.push([li, videoIdx, frameIdxVal]);
  }
  return labelImages;
}
