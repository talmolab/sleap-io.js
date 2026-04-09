import { Instance, PredictedInstance } from "./instance.js";
import { Video } from "./video.js";
import type { Centroid } from "./centroid.js";
import type { BoundingBox } from "./bbox.js";
import type { SegmentationMask } from "./mask.js";
import type { LabelImage } from "./label-image.js";
import type { ROI } from "./roi.js";

/** Strategy for merging annotation lists between frames. */
export type MergeStrategy =
  | "keep_both"
  | "keep_original"
  | "keep_new"
  | "replace_predictions"
  | "auto"
  | "update_tracks";

/** Union of all annotation types stored on a LabeledFrame. */
type Annotation = Centroid | BoundingBox | SegmentationMask | LabelImage | ROI;

/** Annotation attribute names on LabeledFrame. */
type AnnotationAttr = "centroids" | "bboxes" | "masks" | "labelImages" | "rois";

const ANNOTATION_ATTRS: readonly AnnotationAttr[] = [
  "centroids",
  "bboxes",
  "masks",
  "labelImages",
  "rois",
];

/** Shallow-copy an annotation object, preserving its prototype chain. */
function _shallowCopy<T>(item: T): T {
  return Object.create(
    Object.getPrototypeOf(item),
    Object.getOwnPropertyDescriptors(item),
  );
}

/**
 * Extract centroid (x, y) from an annotation based on its modality.
 *
 * @returns A tuple of [x, y] coordinates, or null if the centroid cannot be
 *   computed (e.g., empty mask or empty ROI geometry).
 */
export function _annotationCentroidXy(
  annotation: Annotation,
  attr: AnnotationAttr,
): [number, number] | null {
  if (attr === "centroids") {
    const c = annotation as Centroid;
    return [c.x, c.y];
  } else if (attr === "bboxes") {
    return (annotation as BoundingBox).centroidXy;
  } else if (attr === "rois") {
    const roi = annotation as ROI;
    if (roi.area === 0) return null;
    return roi.centroidXy;
  } else if (attr === "masks") {
    const mask = annotation as SegmentationMask;
    const bb = mask.bbox;
    if (bb.width === 0 && bb.height === 0) return null;
    return [bb.x + bb.width / 2, bb.y + bb.height / 2];
  } else if (attr === "labelImages") {
    const li = annotation as LabelImage;
    const [sx, sy] = li.scale;
    const [ox, oy] = li.offset;
    return [(li.width / 2) / sx + ox, (li.height / 2) / sy + oy];
  }
  return null;
}

/**
 * Find matching annotations between two lists by centroid distance.
 *
 * @returns List of {selfIdx, otherIdx, score} where score = 1 / (1 + distance).
 *
 * NOTE: O(n*m) brute-force without bipartite assignment. Callers are
 * responsible for resolving many-to-one conflicts (e.g., greedy 1:1 in
 * _resolveAnnotationAuto). Fine for typical annotation counts per frame.
 */
export function _findAnnotationMatches(
  selfList: Annotation[],
  otherList: Annotation[],
  attr: AnnotationAttr,
  threshold: number,
): Array<{ selfIdx: number; otherIdx: number; score: number }> {
  const matches: Array<{ selfIdx: number; otherIdx: number; score: number }> =
    [];
  for (let i = 0; i < selfList.length; i++) {
    const c1 = _annotationCentroidXy(selfList[i], attr);
    if (c1 === null) continue;
    for (let j = 0; j < otherList.length; j++) {
      const c2 = _annotationCentroidXy(otherList[j], attr);
      if (c2 === null) continue;
      const dist = Math.hypot(c1[0] - c2[0], c1[1] - c2[1]);
      if (dist <= threshold) {
        matches.push({ selfIdx: i, otherIdx: j, score: 1.0 / (1.0 + dist) });
      }
    }
  }
  return matches;
}

/**
 * Apply auto merge resolution to a list of annotations.
 *
 * Mirrors the instance auto-merge cascade: keep user from self, spatially
 * match, apply user-vs-predicted resolution rules, add unmatched from other,
 * keep unmatched predictions from self.
 */
function _resolveAnnotationAuto(
  selfList: Annotation[],
  otherList: Annotation[],
  attr: AnnotationAttr,
  threshold: number,
): Annotation[] {
  const merged: Annotation[] = [];
  const usedSelfIndices = new Set<number>();

  // 1. Keep all user annotations from self
  for (const ann of selfList) {
    if (!ann.isPredicted) {
      merged.push(ann);
    }
  }

  // 2. Find spatial matches
  const matches = _findAnnotationMatches(selfList, otherList, attr, threshold);

  // 3. Greedy one-to-one matching: sort by score descending, assign each
  // self/other index at most once so no annotation is silently dropped.
  matches.sort((a, b) => b.score - a.score);
  const matchedSelf = new Set<number>();
  const matchedOther = new Set<number>();
  const otherToSelf = new Map<number, number>();
  for (const { selfIdx, otherIdx } of matches) {
    if (!matchedSelf.has(selfIdx) && !matchedOther.has(otherIdx)) {
      otherToSelf.set(otherIdx, selfIdx);
      matchedSelf.add(selfIdx);
      matchedOther.add(otherIdx);
    }
  }

  // 4. Process each annotation from other
  for (let otherIdx = 0; otherIdx < otherList.length; otherIdx++) {
    const otherAnn = otherList[otherIdx];
    if (otherToSelf.has(otherIdx)) {
      const selfIdx = otherToSelf.get(otherIdx)!;
      const selfAnn = selfList[selfIdx];
      usedSelfIndices.add(selfIdx);

      if (!selfAnn.isPredicted && !otherAnn.isPredicted) {
        // user + user → keep self (already in merged)
      } else if (selfAnn.isPredicted && !otherAnn.isPredicted) {
        // predicted + user → replace with other's user
        merged.push(_shallowCopy(otherAnn));
      } else if (!selfAnn.isPredicted && otherAnn.isPredicted) {
        // user + predicted → keep self (already in merged)
      } else {
        // predicted + predicted → keep other's (newer)
        merged.push(_shallowCopy(otherAnn));
      }
    } else {
      // No match → add from other
      merged.push(_shallowCopy(otherAnn));
    }
  }

  // 5. Keep unmatched predictions from self
  for (let selfIdx = 0; selfIdx < selfList.length; selfIdx++) {
    if (selfList[selfIdx].isPredicted && !usedSelfIndices.has(selfIdx)) {
      merged.push(selfList[selfIdx]);
    }
  }

  return merged;
}

/**
 * Update track assignments on self's annotations from spatially matched other's.
 *
 * Modifies selfList in place.
 */
function _resolveAnnotationUpdateTracks(
  selfList: Annotation[],
  otherList: Annotation[],
  attr: AnnotationAttr,
  threshold: number,
): void {
  // LabelImage tracks are per-object in .objects dict, not top-level.
  if (attr === "labelImages") return;

  const matches = _findAnnotationMatches(selfList, otherList, attr, threshold);

  // Best match per selfIdx
  const selfToOther = new Map<number, { otherIdx: number; score: number }>();
  for (const { selfIdx, otherIdx, score } of matches) {
    const existing = selfToOther.get(selfIdx);
    if (!existing || score > existing.score) {
      selfToOther.set(selfIdx, { otherIdx, score });
    }
  }

  selfToOther.forEach(({ otherIdx }, selfIdx) => {
    (selfList[selfIdx] as any).track = (otherList[otherIdx] as any).track;
    (selfList[selfIdx] as any).trackingScore = (otherList[otherIdx] as any).trackingScore;
  });
}

export class LabeledFrame {
  video: Video;
  frameIdx: number;
  instances: Array<Instance | PredictedInstance>;
  isNegative: boolean;
  centroids: Centroid[];
  bboxes: BoundingBox[];
  masks: SegmentationMask[];
  labelImages: LabelImage[];
  rois: ROI[];

  constructor(options: {
    video: Video;
    frameIdx: number;
    instances?: Array<Instance | PredictedInstance>;
    isNegative?: boolean;
    centroids?: Centroid[];
    bboxes?: BoundingBox[];
    masks?: SegmentationMask[];
    labelImages?: LabelImage[];
    rois?: ROI[];
  }) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.instances = options.instances ?? [];
    this.isNegative = options.isNegative ?? false;
    this.centroids = options.centroids ?? [];
    this.bboxes = options.bboxes ?? [];
    this.masks = options.masks ?? [];
    this.labelImages = options.labelImages ?? [];
    this.rois = options.rois ?? [];
  }

  get length(): number {
    return this.instances.length;
  }

  [Symbol.iterator](): Iterator<Instance | PredictedInstance> {
    return this.instances[Symbol.iterator]();
  }

  at(index: number): Instance | PredictedInstance | undefined {
    return this.instances[index];
  }

  get userInstances(): Instance[] {
    return this.instances.filter((inst) => inst instanceof Instance) as Instance[];
  }

  get predictedInstances(): PredictedInstance[] {
    return this.instances.filter((inst) => inst instanceof PredictedInstance) as PredictedInstance[];
  }

  get hasUserInstances(): boolean {
    return this.userInstances.length > 0;
  }

  get hasPredictedInstances(): boolean {
    return this.predictedInstances.length > 0;
  }

  numpy(): number[][][] {
    return this.instances.map((inst) => inst.numpy());
  }

  get image(): Promise<ImageData | ImageBitmap | ArrayBuffer | Uint8Array | null> {
    return this.video.getFrame(this.frameIdx);
  }

  get unusedPredictions(): PredictedInstance[] {
    const usedPredicted = new Set<PredictedInstance>();
    for (const inst of this.instances) {
      if (inst instanceof Instance && inst.fromPredicted) {
        usedPredicted.add(inst.fromPredicted);
      }
    }

    const tracks = this.instances.map((inst) => inst.track).filter((track) => track !== null && track !== undefined);
    if (tracks.length) {
      const usedTracks = new Set(tracks);
      return this.predictedInstances.filter((inst) => !inst.track || !usedTracks.has(inst.track));
    }

    return this.predictedInstances.filter((inst) => !usedPredicted.has(inst));
  }

  removePredictions(): void {
    this.instances = this.instances.filter((inst) => !(inst instanceof PredictedInstance));
    this.centroids = this.centroids.filter((c) => !c.isPredicted);
    this.bboxes = this.bboxes.filter((b) => !b.isPredicted);
    this.masks = this.masks.filter((m) => !m.isPredicted);
    this.labelImages = this.labelImages.filter((li) => !li.isPredicted);
    this.rois = this.rois.filter((r) => !r.isPredicted);
  }

  /**
   * Merge annotation lists from another frame into this frame.
   *
   * Shallow-copies annotations from the other frame to avoid mutating the
   * source when references are later remapped. Video and track references
   * are preserved so that remapping can find them in the mapping dicts.
   *
   * @param other - The frame to merge annotations from.
   * @param strategy - The merge strategy. Controls which annotations are kept:
   *   - "keep_original": Keep self only.
   *   - "keep_new": Replace with other's annotations.
   *   - "keep_both": Keep self + add other's (default).
   *   - "replace_predictions": Keep user from self, add predicted from other.
   *   - "auto": Spatial matching + user-vs-predicted resolution cascade.
   *   - "update_tracks": Spatial matching, then update track assignments.
   * @param threshold - Maximum centroid distance (pixels) for spatial matching
   *   in "auto" and "update_tracks" strategies.
   */
  _mergeAnnotations(
    other: LabeledFrame,
    strategy: MergeStrategy = "keep_both",
    threshold: number = 5.0,
  ): void {
    if (strategy === "keep_original") {
      return;
    }

    if (strategy === "keep_new") {
      for (const attr of ANNOTATION_ATTRS) {
        this[attr] = (other[attr] as Annotation[]).map(_shallowCopy) as any;
      }
      return;
    }

    if (strategy === "replace_predictions") {
      for (const attr of ANNOTATION_ATTRS) {
        const kept = (this[attr] as Annotation[]).filter((a) => !a.isPredicted);
        for (const item of other[attr] as Annotation[]) {
          if (item.isPredicted) {
            kept.push(_shallowCopy(item));
          }
        }
        (this as any)[attr] = kept;
      }
      return;
    }

    if (strategy === "auto") {
      for (const attr of ANNOTATION_ATTRS) {
        (this as any)[attr] = _resolveAnnotationAuto(
          this[attr] as Annotation[],
          other[attr] as Annotation[],
          attr,
          threshold,
        );
      }
      return;
    }

    if (strategy === "update_tracks") {
      for (const attr of ANNOTATION_ATTRS) {
        _resolveAnnotationUpdateTracks(
          this[attr] as Annotation[],
          other[attr] as Annotation[],
          attr,
          threshold,
        );
      }
      return;
    }

    // "keep_both" (default): identity dedup + shallow copy
    for (const attr of ANNOTATION_ATTRS) {
      const existing = new Set(this[attr] as unknown[]);
      for (const item of other[attr] as unknown[]) {
        if (!existing.has(item)) {
          (this[attr] as unknown[]).push(_shallowCopy(item));
        }
      }
    }
  }

  removeEmptyInstances(): void {
    this.instances = this.instances.filter((inst) => !inst.isEmpty);
  }
}
