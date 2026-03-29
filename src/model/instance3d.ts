import { Skeleton } from "./skeleton.js";

export class Instance3D {
  points: number[][] | null;
  skeleton: Skeleton;
  score?: number;
  metadata: Record<string, unknown>;

  constructor(options: {
    points: number[][] | null;
    skeleton: Skeleton;
    score?: number;
    metadata?: Record<string, unknown>;
  }) {
    this.points = options.points;
    this.skeleton = options.skeleton;
    this.score = options.score;
    this.metadata = options?.metadata ?? {};
  }

  get nVisible(): number {
    if (!this.points) return 0;
    return this.points.filter((p) => !p.some(Number.isNaN)).length;
  }

  get isEmpty(): boolean {
    return this.nVisible === 0;
  }
}

export class PredictedInstance3D extends Instance3D {
  pointScores?: number[];

  constructor(options: {
    points: number[][] | null;
    skeleton: Skeleton;
    score?: number;
    pointScores?: number[];
    metadata?: Record<string, unknown>;
  }) {
    super(options);
    this.pointScores = options.pointScores;
  }
}
