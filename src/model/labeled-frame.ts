import { Instance, PredictedInstance } from "./instance.js";
import { Video } from "./video.js";
import type { Centroid } from "./centroid.js";
import type { BoundingBox } from "./bbox.js";
import type { SegmentationMask } from "./mask.js";
import type { LabelImage } from "./label-image.js";
import type { ROI } from "./roi.js";

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
   * Merge annotation lists from another frame, deduplicating by identity.
   *
   * Shallow-copies annotations from the other frame to avoid mutating the
   * source when references are later remapped. Video and track references
   * are preserved so that remapping can find them in the mapping dicts.
   */
  _mergeAnnotations(other: LabeledFrame): void {
    for (const attr of ["centroids", "bboxes", "masks", "labelImages", "rois"] as const) {
      const existing = new Set(this[attr] as unknown[]);
      for (const item of other[attr] as unknown[]) {
        if (!existing.has(item)) {
          const copy = Object.create(Object.getPrototypeOf(item), Object.getOwnPropertyDescriptors(item));
          (this[attr] as unknown[]).push(copy);
        }
      }
    }
  }

  removeEmptyInstances(): void {
    this.instances = this.instances.filter((inst) => !inst.isEmpty);
  }
}
