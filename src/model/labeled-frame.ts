import { Instance, PredictedInstance } from "./instance.js";
import { Video } from "./video.js";

export class LabeledFrame {
  video: Video;
  frameIdx: number;
  instances: Array<Instance | PredictedInstance>;

  constructor(options: { video: Video; frameIdx: number; instances?: Array<Instance | PredictedInstance> }) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.instances = options.instances ?? [];
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
    this.instances = this.instances.filter((inst) => inst instanceof Instance);
  }

  removeEmptyInstances(): void {
    this.instances = this.instances.filter((inst) => !inst.isEmpty);
  }
}
