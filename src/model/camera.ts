import type { Instance } from "./instance.js";
import type { LabeledFrame } from "./labeled-frame.js";
import type { Video } from "./video.js";
import type { Identity } from "./identity.js";
import type { Instance3D } from "./instance3d.js";
import type { Labels } from "./labels.js";

export function rodriguesTransformation(input: number[][] | number[]): {
  matrix: number[][];
  vector: number[];
} {
  if (input.length === 3 && Array.isArray(input[0]) === false) {
    const rvec = input as number[];
    const theta = Math.hypot(rvec[0], rvec[1], rvec[2]);
    if (theta === 0) {
      return {
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        vector: rvec,
      };
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
    const I = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
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
  size?: [number, number];

  constructor(options: {
    name?: string;
    rvec: number[];
    tvec: number[];
    matrix?: number[][];
    distortions?: number[];
    size?: [number, number];
  }) {
    this.name = options.name;
    this.rvec = options.rvec;
    this.tvec = options.tvec;
    this.matrix = options.matrix;
    this.distortions = options.distortions;
    this.size = options.size;
  }
}

export class CameraGroup {
  cameras: Camera[];
  metadata: Record<string, unknown>;

  constructor(options?: {
    cameras?: Camera[];
    metadata?: Record<string, unknown>;
  }) {
    this.cameras = options?.cameras ?? [];
    this.metadata = options?.metadata ?? {};
  }
}

export class InstanceGroup {
  score?: number;
  identity?: Identity;
  instance3d?: Instance3D;
  metadata: Record<string, unknown>;
  private _points?: number[][];

  /**
   * The CONCRETE camera→instance map. Set for in-memory construction and for the
   * JS-inline read path (point-dict instances). `undefined` for a pure-ref group
   * read from a camcorder-format file until first access resolves the refs. Read
   * directly (not via the caching getter) by the write path.
   * @internal
   */
  _instanceByCamera?: Map<Camera, Instance>;

  /**
   * Verbatim as-read index refs from `camcorder_to_lf_and_inst_idx_map`:
   * camera → [globalLabeledFrameIdx, instanceIdx]. Captured on read WITHOUT
   * materializing any frames, so an untouched group can be written back
   * losslessly (see hybrid write-back). `undefined` for in-memory groups.
   * @internal
   */
  _instanceRefsByCamera?: Map<Camera, [number, number]>;

  /**
   * Injected lazy frame resolver (`(globalLfIdx) => LabeledFrame | undefined`).
   * Declared (no runtime slot) so it is NEVER an own-enumerable property — it is
   * installed non-enumerably via `injectSessionFrameResolver` after Labels is
   * built. Enumerability matters: `structuredClone(labels.sessions)` in
   * `Labels.copy()` throws `DataCloneError` on an enumerable function property.
   * @internal
   */
  declare _frameResolver?: (globalLfIdx: number) => LabeledFrame | undefined;

  constructor(options: {
    instanceByCamera?: Map<Camera, Instance> | Record<string, Instance>;
    instanceRefsByCamera?: Map<Camera, [number, number]>;
    score?: number;
    points?: number[][];
    identity?: Identity;
    instance3d?: Instance3D;
    metadata?: Record<string, unknown>;
  }) {
    if (options.instanceByCamera !== undefined) {
      if (options.instanceByCamera instanceof Map) {
        this._instanceByCamera = options.instanceByCamera;
      } else {
        const map = new Map<Camera, Instance>();
        for (const [key, value] of Object.entries(options.instanceByCamera)) {
          map.set(key as unknown as Camera, value);
        }
        this._instanceByCamera = map;
      }
    }
    this._instanceRefsByCamera = options.instanceRefsByCamera;
    this.score = options.score;
    this.identity = options.identity;
    this.instance3d = options.instance3d;
    this._points = options.points;
    this.metadata = options.metadata ?? {};
  }

  get points(): number[][] | undefined {
    if (this.instance3d?.points) return this.instance3d.points;
    return this._points;
  }

  set points(value: number[][] | undefined) {
    if (this.instance3d?.points && value != null) {
      console.warn(
        "Setting points on an InstanceGroup that has an Instance3D — the getter will return instance3d.points, not this value. Set instance3d.points directly instead.",
      );
    }
    this._points = value;
  }

  /**
   * Camera→Instance map. Concrete when the group was built in memory (or via the
   * JS-inline read path); otherwise resolved lazily from `_instanceRefsByCamera`
   * on first access via the injected `_frameResolver` and cached. In-place
   * `.set()`/`.delete()` mutations therefore act on the resolved concrete map.
   */
  get instanceByCamera(): Map<Camera, Instance> {
    if (this._instanceByCamera) return this._instanceByCamera;
    const refs = this._instanceRefsByCamera;
    const resolver = this._frameResolver;
    if (refs && resolver) {
      const map = new Map<Camera, Instance>();
      for (const [camera, [lfIdx, instIdx]] of refs) {
        const lf = resolver(lfIdx);
        const inst = lf?.instances[instIdx];
        if (inst) map.set(camera, inst as Instance);
      }
      this._instanceByCamera = map;
      return map;
    }
    return new Map();
  }

  set instanceByCamera(value: Map<Camera, Instance>) {
    this._instanceByCamera = value;
  }

  get instances(): Instance[] {
    return Array.from(this.instanceByCamera.values());
  }
}

export class FrameGroup {
  frameIdx: number;
  instanceGroups: InstanceGroup[];
  metadata: Record<string, unknown>;

  /**
   * The CONCRETE camera→labeledFrame map. Set for in-memory construction;
   * `undefined` for a pure-ref group read from a camcorder-format file until
   * first access resolves the refs. Read directly (not via the caching getter)
   * by the write path.
   * @internal
   */
  _labeledFrameByCamera?: Map<Camera, LabeledFrame>;

  /**
   * Verbatim as-read index refs from `labeled_frame_by_camera` (or reconstructed
   * from `camcorder_to_lf_and_inst_idx_map`): camera → globalLabeledFrameIdx.
   * Captured on read WITHOUT materializing any frames. `undefined` for in-memory
   * groups.
   * @internal
   */
  _labeledFrameRefsByCamera?: Map<Camera, number>;

  /** @see InstanceGroup._frameResolver @internal */
  declare _frameResolver?: (globalLfIdx: number) => LabeledFrame | undefined;

  constructor(options: {
    frameIdx: number;
    instanceGroups: InstanceGroup[];
    labeledFrameByCamera?:
      | Map<Camera, LabeledFrame>
      | Record<string, LabeledFrame>;
    labeledFrameRefsByCamera?: Map<Camera, number>;
    metadata?: Record<string, unknown>;
  }) {
    this.frameIdx = options.frameIdx;
    this.instanceGroups = options.instanceGroups;
    if (options.labeledFrameByCamera !== undefined) {
      if (options.labeledFrameByCamera instanceof Map) {
        this._labeledFrameByCamera = options.labeledFrameByCamera;
      } else {
        const map = new Map<Camera, LabeledFrame>();
        for (const [key, value] of Object.entries(
          options.labeledFrameByCamera,
        )) {
          map.set(key as unknown as Camera, value);
        }
        this._labeledFrameByCamera = map;
      }
    }
    this._labeledFrameRefsByCamera = options.labeledFrameRefsByCamera;
    this.metadata = options.metadata ?? {};
  }

  /**
   * Camera→LabeledFrame map. Concrete when the group was built in memory;
   * otherwise resolved lazily from `_labeledFrameRefsByCamera` on first access
   * via the injected `_frameResolver` and cached.
   */
  get labeledFrameByCamera(): Map<Camera, LabeledFrame> {
    if (this._labeledFrameByCamera) return this._labeledFrameByCamera;
    const refs = this._labeledFrameRefsByCamera;
    const resolver = this._frameResolver;
    if (refs && resolver) {
      const map = new Map<Camera, LabeledFrame>();
      for (const [camera, lfIdx] of refs) {
        const lf = resolver(lfIdx);
        if (lf) map.set(camera, lf);
      }
      this._labeledFrameByCamera = map;
      return map;
    }
    return new Map();
  }

  set labeledFrameByCamera(value: Map<Camera, LabeledFrame>) {
    this._labeledFrameByCamera = value;
  }

  /**
   * Cameras participating in this frame group. Reads keys from whichever backing
   * map exists WITHOUT resolving refs, so listing cameras never materializes a
   * frame (crucial for the lazy/zero-materialization write path).
   */
  get cameras(): Camera[] {
    return Array.from(
      (
        this._labeledFrameByCamera ??
        this._labeledFrameRefsByCamera ??
        new Map()
      ).keys(),
    );
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

  /**
   * @deprecated Transitional bridge, OPT-IN only. Pass `{ rawSessions: true }`
   * to a read entrypoint (`readSlp`/`readSlpLazy`/`readSlpStreaming`) to capture
   * it; it is `undefined` by default. The object model is now a faithful, lossless
   * projection of `sessions_json` (typed grouping via `InstanceGroup`/`FrameGroup`
   * refs), so consumers should read typed objects rather than this raw dict. It
   * will be removed once LUCID migrates off it. Capturing it deep-clones the whole
   * session payload, so leaving it off avoids doubling session memory in
   * `Labels.copy()`.
   *
   * The verbatim, as-read `sessions_json` dict for this session (when captured).
   *
   * This is a deep-cloned copy of the `JSON.parse` result of the session's
   * `sessions_json` entry, populated on read (eager, lazy, and streaming) ONLY
   * when `rawSessions` is requested. It lets 3D consumers (e.g. luc3d/LUCID) read
   * app-specific state — `calibration`, `camcorder_to_video_idx_map`,
   * `camcorder_to_lf_and_inst_idx_map`, `frame_group_dicts`, and any nested
   * `metadata.lucid` blob — without re-opening the HDF5, including keys
   * sleap-io.js does not itself model.
   *
   * Caveats:
   * - It is a READ-TIME SNAPSHOT: it is deep-cloned from the parsed dict and
   *   holds NO shared references with the object model, so mutating `rawJson`
   *   never affects the model (or what is written to disk) and mutating the
   *   model never affects `rawJson`.
   * - It is NEVER itself re-written to disk. The object model is the single
   *   source of truth on write; `rawJson` is a pure in-memory read surface.
   * - `undefined` for sessions constructed in-memory (never read from disk).
   */
  rawJson?: Record<string, unknown>;

  constructor(options?: {
    cameraGroup?: CameraGroup;
    frameGroupByFrameIdx?: Map<number, FrameGroup>;
    videoByCamera?: Map<Camera, Video>;
    cameraByVideo?: Map<Video, Camera>;
    metadata?: Record<string, unknown>;
    rawJson?: Record<string, unknown>;
  }) {
    this.cameraGroup = options?.cameraGroup ?? new CameraGroup();
    this.frameGroupByFrameIdx = options?.frameGroupByFrameIdx ?? new Map();
    this.videoByCamera = options?.videoByCamera ?? new Map();
    this.cameraByVideo = options?.cameraByVideo ?? new Map();
    this.metadata = options?.metadata ?? {};
    this.rawJson = options?.rawJson;
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

/**
 * Install a lazy frame resolver onto every FrameGroup and InstanceGroup reachable
 * from `labels.sessions`. Session grouping is read BEFORE the frame store exists
 * in all readers, so this is called AFTER the `Labels` is constructed (and, for
 * the lazy reader, after `_lazyFrameList` is attached). The resolver routes
 * through `labels.frameAt(i)`, which materializes only frame `i` under the lazy
 * reader — so ref-backed groups resolve their instances/frames on first access
 * without forcing a full-table materialization.
 *
 * The resolver is installed NON-ENUMERABLE via `Object.defineProperty`: an
 * enumerable function property would make `structuredClone(labels.sessions)` in
 * `Labels.copy()` throw `DataCloneError`.
 */
export function injectSessionFrameResolver(labels: Labels): void {
  const resolver = (i: number): LabeledFrame | undefined => labels.frameAt(i);
  const install = (target: FrameGroup | InstanceGroup): void => {
    Object.defineProperty(target, "_frameResolver", {
      value: resolver,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  };
  for (const session of labels.sessions) {
    for (const frameGroup of session.frameGroupByFrameIdx.values()) {
      install(frameGroup);
      for (const instanceGroup of frameGroup.instanceGroups) {
        install(instanceGroup);
      }
    }
  }
}

function cloneInstanceGroup(
  ig: InstanceGroup,
  remapCam: (c: Camera) => Camera,
  instanceMap?: Map<Instance, Instance>,
): InstanceGroup {
  let instanceByCamera: Map<Camera, Instance> | undefined;
  let instanceRefsByCamera: Map<Camera, [number, number]> | undefined;
  if (ig._instanceRefsByCamera) {
    // Ref-backed (disk-read): carry the index refs (remapping only the Camera
    // keys). The concrete cache is intentionally dropped so the getter
    // re-resolves against the COPY's frames via the re-injected resolver.
    instanceRefsByCamera = new Map();
    for (const [c, pair] of ig._instanceRefsByCamera)
      instanceRefsByCamera.set(remapCam(c), [pair[0], pair[1]]);
  } else if (ig._instanceByCamera) {
    // Concrete in-memory group: remap Camera keys and (when available) Instance
    // values onto the copied objects.
    instanceByCamera = new Map();
    for (const [c, inst] of ig._instanceByCamera)
      instanceByCamera.set(remapCam(c), instanceMap?.get(inst) ?? inst);
  }
  // Carry the standalone 3D points array only when there is no `instance3d`
  // (the `points` getter returns `instance3d.points` otherwise) — avoids
  // touching the private `_points` field.
  const points =
    ig.instance3d || !ig.points ? undefined : ig.points.map((p) => [...p]);
  return new InstanceGroup({
    instanceByCamera,
    instanceRefsByCamera,
    score: ig.score,
    points,
    identity: ig.identity,
    instance3d: ig.instance3d,
    metadata: structuredClone(ig.metadata),
  });
}

/**
 * Deep-clone a {@link RecordingSession} preserving class prototypes (so the lazy
 * grouping getters survive — unlike `structuredClone`, which strips prototypes
 * and the non-enumerable frame resolver) and the as-read index refs.
 *
 * Camera keys are remapped to freshly-cloned cameras; `Video` references are
 * remapped via `videoMap`. Ref-backed (disk-read) grouping is carried as refs
 * and re-resolves against the COPY once {@link injectSessionFrameResolver} runs
 * on it — the copied `labeledFrames` preserve the original's global ordering, so
 * the same indices resolve correctly. Concrete in-memory maps are carried with
 * Camera keys remapped and Instance/LabeledFrame values remapped via
 * `frameMap`/`instanceMap` when supplied (eager copy).
 *
 * NOTE: `identity` and `instance3d` are carried by reference — deep-copying those
 * across a `Labels.copy()` (and relinking to the copy's identities/skeletons) is
 * a separate, pre-existing concern outside the session-grouping model.
 */
export function cloneRecordingSession(
  session: RecordingSession,
  opts: {
    videoMap?: Map<Video, Video>;
    frameMap?: Map<LabeledFrame, LabeledFrame>;
    instanceMap?: Map<Instance, Instance>;
  } = {},
): RecordingSession {
  const { videoMap, frameMap, instanceMap } = opts;
  const cameraMap = new Map<Camera, Camera>();
  const newCameras = session.cameraGroup.cameras.map((cam) => {
    const nc = new Camera({
      name: cam.name,
      rvec: [...cam.rvec],
      tvec: [...cam.tvec],
      matrix: cam.matrix?.map((r) => [...r]),
      distortions: cam.distortions ? [...cam.distortions] : undefined,
      size: cam.size ? [cam.size[0], cam.size[1]] : undefined,
    });
    cameraMap.set(cam, nc);
    return nc;
  });
  const remapCam = (c: Camera): Camera => cameraMap.get(c) ?? c;

  const cameraGroup = new CameraGroup({
    cameras: newCameras,
    metadata: structuredClone(session.cameraGroup.metadata),
  });

  const videoByCamera = new Map<Camera, Video>();
  const cameraByVideo = new Map<Video, Camera>();
  for (const [cam, vid] of session.videoByCamera) {
    const nc = remapCam(cam);
    const nv = videoMap?.get(vid) ?? vid;
    videoByCamera.set(nc, nv);
    cameraByVideo.set(nv, nc);
  }

  const frameGroupByFrameIdx = new Map<number, FrameGroup>();
  for (const [fidx, fg] of session.frameGroupByFrameIdx) {
    const instanceGroups = fg.instanceGroups.map((ig) =>
      cloneInstanceGroup(ig, remapCam, instanceMap),
    );
    let labeledFrameByCamera: Map<Camera, LabeledFrame> | undefined;
    let labeledFrameRefsByCamera: Map<Camera, number> | undefined;
    if (fg._labeledFrameRefsByCamera) {
      labeledFrameRefsByCamera = new Map();
      for (const [c, i] of fg._labeledFrameRefsByCamera)
        labeledFrameRefsByCamera.set(remapCam(c), i);
    } else if (fg._labeledFrameByCamera) {
      labeledFrameByCamera = new Map();
      for (const [c, lf] of fg._labeledFrameByCamera)
        labeledFrameByCamera.set(remapCam(c), frameMap?.get(lf) ?? lf);
    }
    frameGroupByFrameIdx.set(
      fidx,
      new FrameGroup({
        frameIdx: fg.frameIdx,
        instanceGroups,
        labeledFrameByCamera,
        labeledFrameRefsByCamera,
        metadata: structuredClone(fg.metadata),
      }),
    );
  }

  return new RecordingSession({
    cameraGroup,
    frameGroupByFrameIdx,
    videoByCamera,
    cameraByVideo,
    metadata: structuredClone(session.metadata),
    rawJson: session.rawJson ? structuredClone(session.rawJson) : undefined,
  });
}

export function makeCameraFromDict(data: Record<string, unknown>): Camera {
  return new Camera({
    name: data.name as string | undefined,
    rvec: (data.rotation as number[]) ?? [0, 0, 0],
    tvec: (data.translation as number[]) ?? [0, 0, 0],
    matrix: data.matrix as number[][] | undefined,
    distortions: data.distortions as number[] | undefined,
    size: data.size as [number, number] | undefined,
  });
}
