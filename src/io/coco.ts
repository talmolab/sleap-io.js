/**
 * COCO-style dataset reader (read path only).
 *
 * Port of the read path of `sleap_io/io/coco.py`. Supports both pose-estimation
 * datasets (keypoints) and detection-only datasets (bounding boxes and/or
 * segmentation as polygons or RLE), decoding them into a {@link Labels} object.
 *
 * This module is browser-safe: it never imports `fs`/`path` at the top level.
 * The path-based Node loader lives in `coco-node.ts`. The COCO *writing* path
 * (`convert_labels`, `write_labels`, panoptic) is intentionally NOT ported.
 */

import {
  BoundingBox,
  type BoundingBoxOptions,
  PredictedBoundingBox,
} from "../model/bbox.js";
import { Instance, Track } from "../model/instance.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Labels } from "../model/labels.js";
import {
  encodeRle,
  PredictedSegmentationMask,
  type SegmentationMask,
  UserSegmentationMask,
} from "../model/mask.js";
import {
  type Geometry,
  PredictedROI,
  type ROI,
  UserROI,
} from "../model/roi.js";
import { Edge, Node, Skeleton } from "../model/skeleton.js";
import { Video } from "../model/video.js";

/** A COCO category definition. */
export interface CocoCategory {
  id: number;
  name?: string;
  supercategory?: string;
  keypoints?: string[];
  skeleton?: number[][];
}

/** A COCO image entry. */
export interface CocoImage {
  id: number;
  file_name: string;
  height?: number;
  width?: number;
  [key: string]: unknown;
}

/** A COCO RLE segmentation dict. */
export interface CocoRle {
  counts: number[] | string;
  size: [number, number];
}

/** A COCO segmentation field: polygon list, RLE dict, or null. */
export type CocoSegmentation = number[][] | CocoRle | null | undefined;

/** A COCO annotation entry. */
export interface CocoAnnotation {
  id?: number;
  image_id: number;
  category_id: number;
  keypoints?: number[];
  num_keypoints?: number;
  bbox?: number[];
  segmentation?: CocoSegmentation;
  area?: number;
  iscrowd?: number;
  score?: number | null;
  track_id?: number | string;
  instance_id?: number | string;
  attributes?: { object_id?: number | string; [key: string]: unknown };
  [key: string]: unknown;
}

/** A parsed COCO annotation document. */
export interface CocoJson {
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
  [key: string]: unknown;
}

/** Options for reading a COCO dataset. */
export interface ReadCocoOptions {
  /** Root dir for resolving image paths. Node loader defaults to dirname(jsonPath). */
  datasetRoot?: string;
  /** false → 3 channels (RGB), true → 1 channel. Default false. */
  grayscale?: boolean;
  /** "mask" | "roi". Default "mask". Validated up front. */
  segmentationFormat?: "mask" | "roi";
  /** One shared Track per category name. Default false. */
  categoryAsTrack?: boolean;
  /**
   * Browser-safe image resolver. Given a COCO file_name and datasetRoot, return
   * the resolved path string, or null if unresolvable (→ image skipped). The
   * Node loader supplies a default fs-based resolver replicating Python's
   * resolve_image_path (direct + prefixes + recursive basename glob). If omitted
   * in the browser core, the resolver defaults to identity-join:
   *   datasetRoot ? `${datasetRoot}/${file_name}` : file_name  (never null).
   */
  resolveImage?: (
    fileName: string,
    datasetRoot: string | undefined,
  ) => string | null;
}

/**
 * Predicate mirroring Python `_is_coco_data`: true when the value is a non-array
 * object whose `images`, `annotations`, and `categories` fields are all arrays.
 */
export function isCocoData(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    ["images", "annotations", "categories"].every((k) =>
      Array.isArray((data as Record<string, unknown>)[k]),
    )
  );
}

/**
 * Parse a COCO JSON string-or-object and validate the required top-level fields.
 * Mirrors Python `parse_coco_json` (minus the file read, which is Node-only).
 */
export function parseCocoJson(jsonOrObject: string | CocoJson): CocoJson {
  const coco: unknown =
    typeof jsonOrObject === "string" ? JSON.parse(jsonOrObject) : jsonOrObject;
  for (const field of ["images", "annotations", "categories"] as const) {
    if (!Array.isArray((coco as Record<string, unknown>)?.[field])) {
      throw new Error(`Missing required COCO field: ${field}`);
    }
  }
  return coco as CocoJson;
}

/**
 * Create a {@link Skeleton} from a COCO category. Keypoint names become nodes;
 * 1-based skeleton connections become edges (out-of-range / non-pair entries are
 * skipped). Mirrors Python `create_skeleton_from_category`.
 */
export function createSkeletonFromCategory(category: CocoCategory): Skeleton {
  if (!("keypoints" in category) || category.keypoints === undefined) {
    throw new Error(
      `Category '${category.name ?? ""}' has no keypoint definitions`,
    );
  }
  const nodes = category.keypoints.map((name) => new Node(name));
  const edges: Edge[] = [];
  if (Array.isArray(category.skeleton)) {
    for (const conn of category.skeleton) {
      if (Array.isArray(conn) && conn.length === 2) {
        // COCO skeleton uses 1-based indexing.
        const srcIdx = conn[0] - 1;
        const dstIdx = conn[1] - 1;
        if (
          srcIdx >= 0 &&
          srcIdx < nodes.length &&
          dstIdx >= 0 &&
          dstIdx < nodes.length
        ) {
          edges.push(new Edge(nodes[srcIdx], nodes[dstIdx]));
        }
      }
    }
  }
  const name = category.name ?? "unknown";
  return new Skeleton({ nodes, edges, name });
}

/**
 * Decode flat COCO `[x1,y1,v1,...]` keypoints into `(N, 3)` rows `[x, y, flag]`.
 * Visibility 0 → `[NaN, NaN, 0]` (not labeled); any other value → `[x, y, 1]`.
 * Mirrors Python `decode_keypoints`.
 */
export function decodeKeypoints(
  keypoints: number[],
  numKeypoints: number,
  skeleton: Skeleton,
): number[][] {
  if (keypoints.length !== numKeypoints * 3) {
    throw new Error(
      `Keypoints length ${keypoints.length} doesn't match expected ${
        numKeypoints * 3
      }`,
    );
  }
  if (skeleton.nodeNames.length !== numKeypoints) {
    throw new Error(
      `Skeleton has ${skeleton.nodeNames.length} nodes but annotation has ${numKeypoints} keypoints`,
    );
  }
  const points: number[][] = [];
  for (let i = 0; i < numKeypoints; i++) {
    const x = keypoints[i * 3];
    const y = keypoints[i * 3 + 1];
    const v = keypoints[i * 3 + 2];
    if (v === 0) {
      points.push([Number.NaN, Number.NaN, 0]);
    } else {
      points.push([x, y, 1]);
    }
  }
  return points;
}

/**
 * Decode COCO compressed (LEB128 / pycocotools `frString`) RLE `counts` to a
 * list of run lengths. Each byte minus 48 yields 6 bits: low 5 bits are data,
 * `0x20` is the continuation flag, and `0x10` on the final byte marks a negative
 * value (sign-extended). Runs after index 2 are stored as a delta from the run
 * two positions earlier. Mirrors Python `_decode_compressed_rle_counts`.
 *
 * Note: JS bitwise ops are 32-bit signed. The shifts here are safe for run
 * lengths up to 2^31; very large masks (run > 2^31) could overflow, which is out
 * of scope for COCO fixtures.
 */
export function decodeCompressedRleCounts(counts: string): number[] {
  const bytes = new TextEncoder().encode(counts);
  const runLengths: number[] = [];
  let p = 0;
  let m = 0;
  while (p < bytes.length) {
    let x = 0;
    let k = 0;
    let more = 1;
    while (more) {
      const c = bytes[p] - 48;
      x |= (c & 0x1f) << (5 * k);
      more = c & 0x20;
      p += 1;
      k += 1;
      if (!more && c & 0x10) {
        x |= -1 << (5 * k);
      }
    }
    if (m > 2) {
      x += runLengths[m - 2];
    }
    runLengths.push(x);
    m += 1;
  }
  return runLengths;
}

/**
 * Decode COCO RLE `counts`/`size` to a row-major `H×W` boolean 2D array. COCO
 * RLE is column-major (Fortran); this transposes internally so the result is
 * row-major. Uncompressed (number[]) and compressed (string) counts are both
 * supported. Mirrors Python `_decode_coco_rle`.
 */
export function decodeCocoRle(
  counts: number[] | string,
  size: [number, number],
): boolean[][] {
  const runs: number[] =
    typeof counts === "string" ? decodeCompressedRleCounts(counts) : counts;
  const [height, width] = size;
  const total = height * width;
  const flat = new Uint8Array(total); // column-major flat buffer
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const count = runs[i];
    if (i % 2 === 1) {
      // Odd indices are foreground (1) runs.
      const end = Math.min(pos + count, total);
      for (let k = pos; k < end; k++) flat[k] = 1;
    }
    pos += count;
  }
  // Reshape column-major (width, height) then transpose to (height, width).
  const out: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  for (let idx = 0; idx < total; idx++) {
    const col = Math.floor(idx / height);
    const row = idx % height;
    out[row][col] = flat[idx] === 1;
  }
  return out;
}

/** Metadata forwarded to created masks/ROIs/bboxes. */
interface DecodeKwargs {
  category?: string;
  instance?: Instance | null;
  track?: Track | null;
}

/**
 * Build a {@link SegmentationMask} from a row-major binary 2D array. COCO RLE is
 * column-major while sleap-io.js `encodeRle` is row-major, so this flattens the
 * already-transposed `mask2d` row-major and re-encodes it. A score routes to a
 * {@link PredictedSegmentationMask}; otherwise a {@link UserSegmentationMask}.
 */
function makeSegMaskFromBinary(
  mask2d: boolean[][],
  height: number,
  width: number,
  opts: DecodeKwargs & { score?: number | null },
): SegmentationMask {
  const flat = new Uint8Array(height * width);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      flat[r * width + c] = mask2d[r][c] ? 1 : 0;
    }
  }
  const rleCounts = encodeRle(flat, height, width);
  const { score, ...rest } = opts;
  if (score !== undefined && score !== null) {
    return new PredictedSegmentationMask({
      rleCounts,
      height,
      width,
      ...rest,
      score,
    });
  }
  return new UserSegmentationMask({ rleCounts, height, width, ...rest });
}

/** Close a ring (append the first vertex if it does not already close). */
function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, [first[0], first[1]]];
  }
  return ring;
}

/**
 * Decode a COCO `segmentation` field into masks and/or ROIs. RLE always becomes
 * a {@link SegmentationMask} at its native size. Polygons rasterize to a mask in
 * `"mask"` mode (when image dims are positive) or stay as one ROI per ring in
 * `"roi"` mode (or `"mask"` mode without dims). A `score` selects predicted
 * variants. Mirrors Python `_decode_segmentation`.
 */
export function decodeSegmentation(
  segmentation: CocoSegmentation,
  height: number,
  width: number,
  segmentationFormat: "mask" | "roi",
  kwargs: DecodeKwargs,
  score?: number | null,
): { masks: SegmentationMask[]; rois: ROI[] } {
  const masks: SegmentationMask[] = [];
  const rois: ROI[] = [];

  if (segmentation == null) {
    return { masks, rois };
  }

  const predicted = score !== undefined && score !== null;

  // RLE dict path: always materialize as a segmentation mask at native size.
  if (!Array.isArray(segmentation) && typeof segmentation === "object") {
    const rle = segmentation as CocoRle;
    const [nativeH, nativeW] = rle.size;
    const mask2d = decodeCocoRle(rle.counts, rle.size);
    masks.push(
      makeSegMaskFromBinary(mask2d, nativeH, nativeW, { ...kwargs, score }),
    );
    return { masks, rois };
  }

  // Polygon list path.
  if (Array.isArray(segmentation) && segmentation.length > 0) {
    const polygons: number[][][] = [];
    for (const ring of segmentation) {
      const coords: number[][] = [];
      for (let i = 0; i < ring.length - 1; i += 2) {
        coords.push([Number(ring[i]), Number(ring[i + 1])]);
      }
      // Degenerate rings (<3 vertices) cannot form a polygon; skip them.
      if (coords.length >= 3) {
        polygons.push(coords);
      }
    }

    if (polygons.length === 0) {
      return { masks, rois };
    }

    const roiOpts: {
      category?: string;
      instance?: Instance | null;
      track?: Track | null;
    } = {
      category: kwargs.category,
      instance: kwargs.instance,
      track: kwargs.track,
    };

    if (segmentationFormat === "mask" && height > 0 && width > 0) {
      // Build one ROI spanning all rings, then rasterize to a single mask.
      let roi: ROI;
      if (polygons.length === 1) {
        const geometry: Geometry = {
          type: "Polygon",
          coordinates: [closeRing(polygons[0])],
        };
        roi = predicted
          ? new PredictedROI({ geometry, score: score as number, ...roiOpts })
          : new UserROI({ geometry, ...roiOpts });
      } else {
        const geometry: Geometry = {
          type: "MultiPolygon",
          coordinates: polygons.map((ring) => [closeRing(ring)]),
        };
        roi = predicted
          ? new PredictedROI({ geometry, score: score as number, ...roiOpts })
          : new UserROI({ geometry, ...roiOpts });
      }
      // to_mask preserves the predicted/user variant and score from the ROI.
      masks.push(roi.toMask(height, width));
    } else {
      // ROI mode, or mask mode without image dims: one ROI per ring.
      for (const coords of polygons) {
        if (predicted) {
          rois.push(
            new PredictedROI({
              geometry: { type: "Polygon", coordinates: [closeRing(coords)] },
              score: score as number,
              ...roiOpts,
            }),
          );
        } else {
          rois.push(UserROI.fromPolygon(coords, roiOpts));
        }
      }
    }
  }

  return { masks, rois };
}

/**
 * Read a COCO dataset from a JSON string or parsed object into {@link Labels}.
 * Browser-safe core (no `fs`); image resolution is delegated to
 * `options.resolveImage` (defaults to identity-join). Mirrors Python
 * `read_labels` (read path).
 */
export function readCoco(
  jsonOrObject: string | CocoJson,
  options: ReadCocoOptions = {},
): Labels {
  // Step 0: validate segmentation format before any parsing.
  const fmt = options.segmentationFormat ?? "mask";
  if (fmt !== "mask" && fmt !== "roi") {
    throw new Error(
      `segmentationFormat must be 'mask' or 'roi', got ${JSON.stringify(fmt)}.`,
    );
  }

  const grayscale = options.grayscale ?? false;
  const categoryAsTrack = options.categoryAsTrack ?? false;
  const datasetRoot = options.datasetRoot;
  const resolveImage =
    options.resolveImage ??
    ((fileName: string, root: string | undefined) =>
      root ? `${root}/${fileName}` : fileName);

  // Step 1: parse + validate.
  const coco = parseCocoJson(jsonOrObject);

  // Step 2: category-track closure.
  const categoryTrackDict = new Map<string, Track>();
  function categoryTrack(catName: string): Track | null {
    if (!categoryAsTrack || !catName) return null;
    let t = categoryTrackDict.get(catName);
    if (!t) {
      t = new Track(catName);
      categoryTrackDict.set(catName, t);
    }
    return t;
  }

  // Step 3: categories → skeletons + name map.
  const skeletons = new Map<number, Skeleton>();
  const categoryNames = new Map<number, string>();
  for (const cat of coco.categories) {
    categoryNames.set(cat.id, cat.name ?? "");
    if (Array.isArray(cat.keypoints) && cat.keypoints.length > 0) {
      skeletons.set(cat.id, createSkeletonFromCategory(cat));
    }
  }

  // Step 4: explicit track-id → Track.
  const trackDict = new Map<string | number, Track>();

  // Step 5: group annotations by image_id (preserve file order).
  const imageAnnotations = new Map<number, CocoAnnotation[]>();
  for (const ann of coco.annotations) {
    let list = imageAnnotations.get(ann.image_id);
    if (!list) {
      list = [];
      imageAnnotations.set(ann.image_id, list);
    }
    list.push(ann);
  }

  // Step 6: group images by (height, width); assign image_id-keyed frame idx.
  const shapeToImages = new Map<string, string[]>();
  const imageIdToPath = new Map<number, string>();
  const imageIdToShape = new Map<number, [number, number]>();
  const imageIdToFrameIdx = new Map<number, number>();

  for (const img of coco.images) {
    const imageId = img.id;
    const fileName = img.file_name;
    const height = img.height ?? 0;
    const width = img.width ?? 0;
    const resolved = resolveImage(fileName, datasetRoot);
    if (resolved == null) continue; // skip unresolvable image entirely
    imageIdToPath.set(imageId, resolved);
    const shapeKey = `${height},${width}`;
    imageIdToShape.set(imageId, [height, width]);
    let group = shapeToImages.get(shapeKey);
    if (!group) {
      group = [];
      shapeToImages.set(shapeKey, group);
    }
    imageIdToFrameIdx.set(imageId, group.length);
    group.push(resolved);
  }

  // Step 7: one Video per shape group.
  const channels = grayscale ? 1 : 3;
  const shapeToVideo = new Map<string, Video>();
  for (const [shapeKey, paths] of shapeToImages) {
    const [height, width] = shapeKey.split(",").map(Number) as [number, number];
    const video = new Video({
      filename: paths,
      openBackend: false,
      backendMetadata: {
        shape: [paths.length, height, width, channels],
        grayscale,
      },
    });
    shapeToVideo.set(shapeKey, video);
  }

  // Step 8: build LabeledFrames (one per resolved image, always).
  const labeledFrames: LabeledFrame[] = [];
  for (const img of coco.images) {
    const imageId = img.id;
    if (!imageIdToPath.has(imageId)) continue;

    const [imgHeight, imgWidth] = imageIdToShape.get(imageId) as [
      number,
      number,
    ];
    const shapeKey = `${imgHeight},${imgWidth}`;
    const video = shapeToVideo.get(shapeKey) as Video;
    const frameIdx = imageIdToFrameIdx.get(imageId) as number;

    const instances: Instance[] = [];
    const masks: SegmentationMask[] = [];
    const rois: ROI[] = [];
    const bboxes: BoundingBox[] = [];

    const annotations = imageAnnotations.get(imageId) ?? [];
    for (const ann of annotations) {
      const categoryId = ann.category_id;
      const catName = categoryNames.get(categoryId) ?? "";
      const hasKpts = Array.isArray(ann.keypoints) && ann.keypoints.length > 0;

      if (hasKpts && skeletons.has(categoryId)) {
        // Branch A: pose annotation + linked user seg/bbox (no score routing).
        const skeleton = skeletons.get(categoryId) as Skeleton;

        // Extract track id (object_id → track_id → instance_id), else category.
        const trackId =
          ann.attributes?.object_id || ann.track_id || ann.instance_id;
        let track: Track | null;
        if (trackId != null) {
          let t = trackDict.get(trackId);
          if (!t) {
            t = new Track(`track_${trackId}`);
            trackDict.set(trackId, t);
          }
          track = t;
        } else {
          track = categoryTrack(catName);
        }

        const expected = skeleton.nodeNames.length; // node count, not num_keypoints
        const pointsData = decodeKeypoints(
          ann.keypoints as number[],
          expected,
          skeleton,
        );
        const instance = Instance.fromNumpy({ pointsData, skeleton, track });
        instances.push(instance);

        // Linked seg/bbox: always user variants, share the instance + track.
        const segResult = decodeSegmentation(
          ann.segmentation,
          imgHeight,
          imgWidth,
          fmt,
          { category: catName, instance, track },
        );
        masks.push(...segResult.masks);
        rois.push(...segResult.rois);

        if (ann.bbox != null) {
          const [x, y, w, h] = ann.bbox;
          bboxes.push(
            BoundingBox.fromXywh(x, y, w, h, {
              category: catName,
              instance,
              track,
            }),
          );
        }
      } else {
        // Branch B: detection-only. score routes to predicted variants.
        const kwargs: DecodeKwargs = {
          category: catName,
          track: categoryTrack(catName),
        };
        const score = ann.score;
        const segResult = decodeSegmentation(
          ann.segmentation,
          imgHeight,
          imgWidth,
          fmt,
          kwargs,
          score,
        );
        masks.push(...segResult.masks);
        rois.push(...segResult.rois);

        // Fallback bbox only if segmentation produced no geometry (#493).
        if (
          ann.bbox != null &&
          segResult.masks.length === 0 &&
          segResult.rois.length === 0
        ) {
          const [x, y, w, h] = ann.bbox;
          if (score !== undefined && score !== null) {
            const bboxOpts: BoundingBoxOptions & { score: number } = {
              x1: x,
              y1: y,
              x2: x + w,
              y2: y + h,
              category: catName,
              track: kwargs.track,
              score,
            };
            bboxes.push(new PredictedBoundingBox(bboxOpts));
          } else {
            bboxes.push(
              BoundingBox.fromXywh(x, y, w, h, {
                category: catName,
                track: kwargs.track,
              }),
            );
          }
        }
      }
    }

    const frame = new LabeledFrame({ video, frameIdx, instances });
    frame.masks.push(...masks);
    frame.rois.push(...rois);
    frame.bboxes.push(...bboxes);
    labeledFrames.push(frame);
  }

  // Step 9: return Labels (auto-collects skeletons/tracks/videos/etc).
  return new Labels({
    labeledFrames,
    provenance: { source: datasetRoot ?? "" },
  });
}

/**
 * Read multiple COCO splits (browser-safe core). Each split is read
 * independently with fresh track dicts. Mirrors Python `read_labels_set` minus
 * the directory glob (which lives in the Node loader). The provenance `split`
 * key is set per split.
 */
export function readCocoSet(
  splits: Record<string, string | CocoJson>,
  options: ReadCocoOptions = {},
): Record<string, Labels> {
  const result: Record<string, Labels> = {};
  for (const [splitName, json] of Object.entries(splits)) {
    const labels = readCoco(json, options);
    labels.provenance = { ...labels.provenance, split: splitName };
    result[splitName] = labels;
  }
  return result;
}
