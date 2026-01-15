import { Instance } from "./instance.js";
import { LabeledFrame } from "./labeled-frame.js";
import { Video } from "./video.js";

export function rodriguesTransformation(input: number[][] | number[]): { matrix: number[][]; vector: number[] } {
  if (input.length === 3 && Array.isArray(input[0]) === false) {
    const rvec = input as number[];
    const theta = Math.hypot(rvec[0], rvec[1], rvec[2]);
    if (theta === 0) {
      return { matrix: [[1, 0, 0],[0, 1, 0],[0, 0, 1]], vector: rvec };
    }
    const axis = rvec.map((v) => v / theta);
    const [x, y, z] = axis;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const K = [
      [0, -z, y],
      [z, 0, -x],
      [-y, x, 0],
    ];
    const I = [[1, 0, 0],[0, 1, 0],[0, 0, 1]];
    const KK = multiply3x3(K, K);
    const matrix = add3x3(add3x3(I, scale3x3(K, sin)), scale3x3(KK, 1 - cos));
    return { matrix, vector: rvec };
  }

  const matrix = input as number[][];
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  const cosTheta = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const theta = Math.acos(cosTheta);
  if (theta === 0) {
    return { matrix, vector: [0, 0, 0] };
  }
  const rx = (matrix[2][1] - matrix[1][2]) / (2 * Math.sin(theta));
  const ry = (matrix[0][2] - matrix[2][0]) / (2 * Math.sin(theta));
  const rz = (matrix[1][0] - matrix[0][1]) / (2 * Math.sin(theta));
  return { matrix, vector: [rx * theta, ry * theta, rz * theta] };
}

function multiply3x3(a: number[][], b: number[][]): number[][] {
  const result = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      result[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return result;
}

function add3x3(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}

function scale3x3(a: number[][], scale: number): number[][] {
  return a.map((row) => row.map((val) => val * scale));
}

export class Camera {
  name?: string;
  rvec: number[];
  tvec: number[];
  matrix?: number[][];
  distortions?: number[];

  constructor(options: { name?: string; rvec: number[]; tvec: number[]; matrix?: number[][]; distortions?: number[] }) {
    this.name = options.name;
    this.rvec = options.rvec;
    this.tvec = options.tvec;
    this.matrix = options.matrix;
    this.distortions = options.distortions;
  }
}

export class CameraGroup {
  cameras: Camera[];
  metadata: Record<string, unknown>;

  constructor(options?: { cameras?: Camera[]; metadata?: Record<string, unknown> }) {
    this.cameras = options?.cameras ?? [];
    this.metadata = options?.metadata ?? {};
  }
}

export class InstanceGroup {
  instanceByCamera: Map<Camera, Instance>;
  score?: number;
  points?: number[][];
  metadata: Record<string, unknown>;

  constructor(options: {
    instanceByCamera: Map<Camera, Instance> | Record<string, Instance>;
    score?: number;
    points?: number[][];
    metadata?: Record<string, unknown>;
  }) {
    this.instanceByCamera = options.instanceByCamera instanceof Map ? options.instanceByCamera : new Map();
    if (!(options.instanceByCamera instanceof Map)) {
      for (const [key, value] of Object.entries(options.instanceByCamera)) {
        const camera = key as unknown as Camera;
        this.instanceByCamera.set(camera, value);
      }
    }
    this.score = options.score;
    this.points = options.points;
    this.metadata = options.metadata ?? {};
  }

  get instances(): Instance[] {
    return Array.from(this.instanceByCamera.values());
  }
}

export class FrameGroup {
  frameIdx: number;
  instanceGroups: InstanceGroup[];
  labeledFrameByCamera: Map<Camera, LabeledFrame>;
  metadata: Record<string, unknown>;

  constructor(options: {
    frameIdx: number;
    instanceGroups: InstanceGroup[];
    labeledFrameByCamera: Map<Camera, LabeledFrame> | Record<string, LabeledFrame>;
    metadata?: Record<string, unknown>;
  }) {
    this.frameIdx = options.frameIdx;
    this.instanceGroups = options.instanceGroups;
    this.labeledFrameByCamera = options.labeledFrameByCamera instanceof Map ? options.labeledFrameByCamera : new Map();
    if (!(options.labeledFrameByCamera instanceof Map)) {
      for (const [key, value] of Object.entries(options.labeledFrameByCamera)) {
        const camera = key as unknown as Camera;
        this.labeledFrameByCamera.set(camera, value);
      }
    }
    this.metadata = options.metadata ?? {};
  }

  get cameras(): Camera[] {
    return Array.from(this.labeledFrameByCamera.keys());
  }

  get labeledFrames(): LabeledFrame[] {
    return Array.from(this.labeledFrameByCamera.values());
  }

  getFrame(camera: Camera): LabeledFrame | undefined {
    return this.labeledFrameByCamera.get(camera);
  }
}

export class RecordingSession {
  cameraGroup: CameraGroup;
  frameGroupByFrameIdx: Map<number, FrameGroup>;
  videoByCamera: Map<Camera, Video>;
  cameraByVideo: Map<Video, Camera>;
  metadata: Record<string, unknown>;

  constructor(options?: {
    cameraGroup?: CameraGroup;
    frameGroupByFrameIdx?: Map<number, FrameGroup>;
    videoByCamera?: Map<Camera, Video>;
    cameraByVideo?: Map<Video, Camera>;
    metadata?: Record<string, unknown>;
  }) {
    this.cameraGroup = options?.cameraGroup ?? new CameraGroup();
    this.frameGroupByFrameIdx = options?.frameGroupByFrameIdx ?? new Map();
    this.videoByCamera = options?.videoByCamera ?? new Map();
    this.cameraByVideo = options?.cameraByVideo ?? new Map();
    this.metadata = options?.metadata ?? {};
  }

  get frameGroups(): Map<number, FrameGroup> {
    return this.frameGroupByFrameIdx;
  }

  get videos(): Video[] {
    return Array.from(this.videoByCamera.values());
  }

  get cameras(): Camera[] {
    return Array.from(this.videoByCamera.keys());
  }

  addVideo(video: Video, camera: Camera): void {
    if (!this.cameraGroup.cameras.includes(camera)) {
      this.cameraGroup.cameras.push(camera);
    }
    this.videoByCamera.set(camera, video);
    this.cameraByVideo.set(video, camera);
  }

  getCamera(video: Video): Camera | undefined {
    return this.cameraByVideo.get(video);
  }

  getVideo(camera: Camera): Video | undefined {
    return this.videoByCamera.get(camera);
  }
}

export function makeCameraFromDict(data: Record<string, unknown>): Camera {
  return new Camera({
    name: data.name as string | undefined,
    rvec: (data.rotation as number[]) ?? [0, 0, 0],
    tvec: (data.translation as number[]) ?? [0, 0, 0],
    matrix: data.matrix as number[][] | undefined,
    distortions: data.distortions as number[] | undefined,
  });
}
