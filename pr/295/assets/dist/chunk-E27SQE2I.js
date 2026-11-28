import {
  isUrl,
  redactUrl
} from "./chunk-3UBNQTMV.js";

// src/model/instance.ts
var _centroidFactory = null;
function _registerCentroidFactory(factory) {
  _centroidFactory = factory;
}
var _bboxFactory = null;
function _registerBboxFactory(factory) {
  _bboxFactory = factory;
}
var Track = class {
  name;
  constructor(name = "") {
    this.name = name;
  }
  matches(other, method = "name") {
    if (method === "name") {
      return this.name === other.name;
    }
    if (method === "identity") {
      return this === other;
    }
    throw new Error("Unknown matching method: " + method);
  }
};
var EMPTY_F64 = new Float64Array(0);
var EMPTY_U8 = new Uint8Array(0);
function pointsEmpty(length, names) {
  const pts = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      name: names?.[i]
    });
  }
  return pts;
}
function predictedPointsEmpty(length, names) {
  const pts = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      score: Number.NaN,
      name: names?.[i]
    });
  }
  return pts;
}
function clonePoint(p, name) {
  const xy = p.xy;
  const out = {
    xy: [xy[0], xy[1]],
    visible: p.visible,
    complete: p.complete,
    name: name ?? p.name
  };
  if (p.labeled === false) out.labeled = false;
  const score = p.score;
  if (typeof score === "number") out.score = score;
  return out;
}
function pointsFromArray(array, names) {
  const pts = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN];
    const visible = row.length > 2 ? Boolean(row[2]) : !Number.isNaN(row[0]);
    const complete = row.length > 3 ? Boolean(row[3]) : false;
    pts.push({
      xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN],
      visible,
      complete,
      name: names?.[i]
    });
  }
  return pts;
}
function predictedPointsFromArray(array, names) {
  const pts = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN, Number.NaN];
    const visible = row.length > 3 ? Boolean(row[3]) : !Number.isNaN(row[0]);
    const complete = row.length > 4 ? Boolean(row[4]) : false;
    pts.push({
      xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN],
      score: row[2] ?? Number.NaN,
      visible,
      complete,
      name: names?.[i]
    });
  }
  return pts;
}
var PointView = class {
  // True-private backing (ECMAScript #fields) so a view carries no enumerable
  // own properties: `{ ...point }` and `JSON.stringify(point)` see nothing but
  // the getters, and there is no circular `_owner` leak. The `Point` fields are
  // exposed as accessors below.
  #owner;
  #i;
  constructor(owner, i) {
    this.#owner = owner;
    this.#i = i;
  }
  get xy() {
    const xy = this.#owner._xy;
    const j = this.#i << 1;
    return [xy[j], xy[j + 1]];
  }
  set xy(v) {
    const xy = this.#owner._xy;
    const j = this.#i << 1;
    xy[j] = v[0];
    xy[j + 1] = v[1];
  }
  get visible() {
    return this.#owner._visible[this.#i] !== 0;
  }
  set visible(v) {
    this.#owner._visible[this.#i] = v ? 1 : 0;
  }
  get complete() {
    return this.#owner._complete[this.#i] !== 0;
  }
  set complete(v) {
    this.#owner._complete[this.#i] = v ? 1 : 0;
  }
  /** Whether the point is labelled; a visible point always is. */
  get labeled() {
    const labeled = this.#owner._labeled;
    return labeled ? labeled[this.#i] !== 0 || this.#owner._visible[this.#i] !== 0 : true;
  }
  set labeled(v) {
    if (v && !this.#owner._labeled) return;
    this.#owner._labeledColumn()[this.#i] = v ? 1 : 0;
  }
  get score() {
    const s = this.#owner._score;
    return s ? s[this.#i] : void 0;
  }
  set score(v) {
    this.#owner._scoreColumn()[this.#i] = v ?? Number.NaN;
  }
  get name() {
    return this.#owner._pointName(this.#i);
  }
  set name(v) {
    this.#owner._setPointName(this.#i, v);
  }
};
var Instance = class _Instance {
  skeleton;
  track;
  fromPredicted;
  trackingScore;
  /**
   * Persistent cross-video re-ID identity of this detection (SLP 2.5+), distinct
   * from the ephemeral within-video {@link Track}. Persisted in the `/identity`
   * catalog + `/identity/links`; attached after read, defaults to null.
   */
  identity = null;
  /** Confidence of the {@link identity} assignment (SLP 2.5+); null if unrecorded. */
  identityScore = null;
  /** Per-detection re-ID appearance embedding (SLP 2.5+); persisted in `/embeddings`. */
  identityEmbedding = null;
  /** Class/category membership (SLP 2.7+); persisted via the `/categories` catalog + links. */
  category = null;
  /** Confidence of the {@link category} assignment (SLP 2.7+); null if unrecorded. */
  categoryScore = null;
  /** Per-detection category appearance embedding (SLP 2.7+); persisted in `/embeddings`. */
  categoryEmbedding = null;
  /**
   * Per-instance values (bool, number or string), stored by SLP format 3.0 in
   * `/instances/metadata`. The 2.x layout cannot store them, so a save
   * writes format 3.0 for them (see `slpVersion` on `saveSlpToBytes`).
   */
  metadata = {};
  // Columnar keypoint storage (retained). Built once at construction from the
  // transient `Point[]`/dict, which is then discarded. `points` reads/writes go
  // through lightweight PointView flyweights over these. See {@link PointView}.
  _xy = EMPTY_F64;
  // interleaved [x0,y0,x1,y1,...], length 2n
  _visible = EMPTY_U8;
  // n
  _complete = EMPTY_U8;
  // n
  /** n, or null when every point is labelled (always so for 1.x/2.x files). */
  _labeled = null;
  _score = null;
  // n (predicted) or null (user)
  _names = null;
  // null ⇒ derive from skeleton
  _n = 0;
  constructor(options) {
    this.skeleton = options.skeleton;
    this.track = options.track ?? null;
    this.fromPredicted = options.fromPredicted ?? null;
    this.trackingScore = options.trackingScore ?? 0;
    this.metadata = options.metadata ? { ...options.metadata } : {};
    let pts;
    if (Array.isArray(options.points)) {
      const arr = options.points;
      pts = arr.length > 0 && Array.isArray(arr[0]) ? pointsFromArray(arr, options.skeleton.nodeNames) : arr;
    } else {
      pts = pointsFromDict(options.points, options.skeleton);
    }
    this._ingest(pts);
  }
  /** Pack a transient `Point[]` into the columnar typed-array storage. */
  _ingest(pts) {
    const n = pts.length;
    const xy = new Float64Array(2 * n);
    const visible = new Uint8Array(n);
    const complete = new Uint8Array(n);
    const hasScore = n > 0 && typeof pts[0].score === "number";
    const score = hasScore ? new Float64Array(n) : null;
    let labeled = null;
    const nodeNames = this.skeleton.nodeNames;
    let names = null;
    for (let i = 0; i < n; i += 1) {
      const p = pts[i];
      const j = i << 1;
      xy[j] = p.xy[0];
      xy[j + 1] = p.xy[1];
      visible[i] = p.visible ? 1 : 0;
      complete[i] = p.complete ? 1 : 0;
      if (p.labeled === false) {
        labeled ??= new Uint8Array(n).fill(1);
        labeled[i] = 0;
      }
      if (score) score[i] = p.score ?? Number.NaN;
      if (p.name !== nodeNames[i]) {
        if (!names) {
          names = new Array(n);
          for (let k = 0; k < n; k += 1) names[k] = nodeNames[k];
        }
        names[i] = p.name;
      }
    }
    this._xy = xy;
    this._visible = visible;
    this._complete = complete;
    this._labeled = labeled;
    this._score = score;
    this._names = names;
    this._n = n;
  }
  /**
   * Fill the columnar storage directly from the SLP readers' parsed point
   * columns over `[start, end)`, skipping the intermediate `Point[]` literals
   * (the slicePoints → pointsFromArray → `_ingest` path allocates ~3 throwaway
   * objects per point). Values match that path exactly: `x ?? NaN`, `y ?? NaN`,
   * `Boolean(visible)`, `Boolean(complete)`, and (predicted) `score ?? NaN`;
   * names derive from the skeleton. Used by {@link Instance._fromColumns}.
   */
  _fillFromColumns(columns, start, end, predicted) {
    const n = Math.max(0, end - start);
    const xy = new Float64Array(2 * n);
    const visible = new Uint8Array(n);
    const complete = new Uint8Array(n);
    const score = predicted ? new Float64Array(n) : null;
    const cx = columns.x;
    const cy = columns.y;
    const cv = columns.visible;
    const cc = columns.complete;
    const cl = columns.labeled;
    const cs = columns.score;
    let labeled = null;
    for (let i = 0; i < n; i += 1) {
      const src = start + i;
      const j = i << 1;
      xy[j] = cx && cx[src] != null ? cx[src] : Number.NaN;
      xy[j + 1] = cy && cy[src] != null ? cy[src] : Number.NaN;
      visible[i] = cv && cv[src] ? 1 : 0;
      complete[i] = cc && cc[src] ? 1 : 0;
      if (cl && cl[src] != null && !cl[src]) {
        labeled ??= new Uint8Array(n).fill(1);
        labeled[i] = 0;
      }
      if (score)
        score[i] = cs && cs[src] != null ? cs[src] : Number.NaN;
    }
    this._xy = xy;
    this._visible = visible;
    this._complete = complete;
    this._labeled = labeled;
    this._score = score;
    this._names = null;
    this._n = n;
  }
  /**
   * Build an Instance directly from reader point columns over `[start, end)`,
   * without materializing a `Point[]`. Internal fast path for buildLabeledFrames;
   * equivalent to `new Instance({ points: pointsFromArray(slicePoints(...)) })`.
   */
  static _fromColumns(opts) {
    const inst = Object.create(_Instance.prototype);
    inst.skeleton = opts.skeleton;
    inst.track = opts.track ?? null;
    inst.fromPredicted = opts.fromPredicted ?? null;
    inst.trackingScore = opts.trackingScore ?? 0;
    inst.metadata = opts.metadata ?? {};
    inst._labeled = null;
    inst._fillFromColumns(opts.columns, opts.start, opts.end, false);
    return inst;
  }
  /** Lazily allocate the score column (for a user instance gaining scores). */
  _scoreColumn() {
    if (!this._score) this._score = new Float64Array(this._n).fill(Number.NaN);
    return this._score;
  }
  /** Lazily allocate the `labeled` column (all labelled) on the first `false`. */
  _labeledColumn() {
    if (!this._labeled) this._labeled = new Uint8Array(this._n).fill(1);
    return this._labeled;
  }
  /**
   * Number of unlabelled points: neither labelled nor visible. These are what
   * the 2.x layout cannot store (see `unlabeledAs` on the writers).
   */
  get nUnlabeled() {
    const labeled = this._labeled;
    if (!labeled) return 0;
    let count = 0;
    for (let i = 0; i < this._n; i += 1) {
      if (!labeled[i] && !this._visible[i]) count += 1;
    }
    return count;
  }
  /** Node name for point `i` — derived from the skeleton unless overridden. */
  _pointName(i) {
    return this._names ? this._names[i] : this.skeleton.nodeNames[i];
  }
  _setPointName(i, v) {
    if (!this._names) {
      const nn = this.skeleton.nodeNames;
      this._names = new Array(this._n);
      for (let k = 0; k < this._n; k += 1) this._names[k] = nn[k];
    }
    this._names[i] = v;
  }
  /** The keypoints as an array of live {@link PointView}s (built on demand). */
  get points() {
    const n = this._n;
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) out[i] = new PointView(this, i);
    return out;
  }
  set points(pts) {
    this._ingest(pts);
  }
  static fromArray(points, skeleton) {
    return new _Instance({
      points: pointsFromArray(points, skeleton.nodeNames),
      skeleton
    });
  }
  static fromNumpy(options) {
    return new _Instance({
      points: pointsFromArray(options.pointsData, options.skeleton.nodeNames),
      skeleton: options.skeleton,
      track: options.track ?? null,
      fromPredicted: options.fromPredicted ?? null,
      trackingScore: options.trackingScore
    });
  }
  static empty(options) {
    return new _Instance({
      points: pointsEmpty(
        options.skeleton.nodeNames.length,
        options.skeleton.nodeNames
      ),
      skeleton: options.skeleton
    });
  }
  get length() {
    return this._n;
  }
  get nVisible() {
    let count = 0;
    for (let i = 0; i < this._n; i += 1) if (this._visible[i]) count += 1;
    return count;
  }
  getPoint(target) {
    let index;
    if (typeof target === "number") {
      if (target < 0 || target >= this._n)
        throw new Error("Point index out of range.");
      index = target;
    } else if (typeof target === "string") {
      index = this.skeleton.index(target);
    } else {
      index = this.skeleton.index(target.name);
    }
    return new PointView(this, index);
  }
  numpy(options) {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    const xy = this._xy;
    const out = new Array(this._n);
    for (let i = 0; i < this._n; i += 1) {
      if (invisibleAsNaN && !this._visible[i]) {
        out[i] = [Number.NaN, Number.NaN];
      } else {
        const j = i << 1;
        out[i] = [xy[j], xy[j + 1]];
      }
    }
    return out;
  }
  toString() {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `Instance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName})`;
  }
  /** Mean of visible point coordinates as `[x, y]`, or `null` if no points visible. */
  get centroidXy() {
    let sumX = 0, sumY = 0, count = 0;
    const xy = this._xy;
    for (let i = 0; i < this._n; i += 1) {
      const j = i << 1;
      const x = xy[j];
      const y = xy[j + 1];
      if (this._visible[i] && !Number.isNaN(x) && !Number.isNaN(y)) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
    if (count === 0) return null;
    return [sumX / count, sumY / count];
  }
  /**
   * Create a Centroid from this instance.
   *
   * @param method - Computation method. Accepts the legacy camelCase names
   *   (`"centerOfMass"` (default), `"bboxCenter"`, `"anchor"`) and Python's
   *   snake_case names (`"center_of_mass"`, `"bbox_center"`). The persisted
   *   `source` is always canonical snake_case for Python interop.
   * @param node - Node specification for "anchor" method.
   * @returns UserCentroid or PredictedCentroid depending on instance type.
   */
  toCentroid(method, node) {
    if (!_centroidFactory) {
      throw new Error(
        "Centroid not available. Import centroid.ts before calling toCentroid()."
      );
    }
    return _centroidFactory(this, { method, node });
  }
  /**
   * Create an axis-aligned bounding box from this instance.
   *
   * `mode: "tight"` (default) fits the visible points; `mode: "centered"`
   * builds a fixed-`size` box around the instance's centroid. `padding`
   * inflates the box (scalar or `[px, py]`). A `PredictedInstance` yields a
   * `PredictedBoundingBox` with its `score`, anything else a
   * `UserBoundingBox`; the box links back via `box.instance`. Mirrors Python
   * `Instance.to_bbox` (oriented boxes aren't supported yet).
   *
   * @see BoundingBox.fromInstance for the full option list.
   */
  toBbox(options) {
    if (!_bboxFactory) {
      throw new Error(
        "BoundingBox not available. Import bbox.ts before calling toBbox()."
      );
    }
    return _bboxFactory(this, options);
  }
  get isEmpty() {
    for (let i = 0; i < this._n; i += 1) {
      if (this._visible[i] && !Number.isNaN(this._xy[i << 1])) return false;
    }
    return true;
  }
  /**
   * Check if this instance has the same pose as another instance.
   *
   * Mirrors Python `Instance.same_pose_as` (instance.py:699-753).
   *
   * @param other - Another instance to compare with.
   * @param tolerance - Maximum distance (in pixels) between corresponding points
   *   for them to be considered the same. If `null`/`undefined`, uses exact
   *   comparison including NaN==NaN handling.
   * @returns `true` if the instances have the same pose within tolerance.
   */
  samePoseAs(other, tolerance) {
    if (!this.skeleton.matches(other.skeleton)) return false;
    const a = this.numpy();
    const b = other.numpy();
    if (tolerance == null) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          const av = a[i][j];
          const bv = b[i][j];
          const aNaN = Number.isNaN(av);
          const bNaN = Number.isNaN(bv);
          if (aNaN !== bNaN) return false;
          if (!aNaN && av !== bv) return false;
        }
      }
      return true;
    }
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        if (Number.isNaN(a[i][j]) !== Number.isNaN(b[i][j])) return false;
      }
    }
    const aVals = [];
    const bVals = [];
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        if (!Number.isNaN(a[i][j])) {
          aVals.push(a[i][j]);
          bVals.push(b[i][j]);
        }
      }
    }
    if (aVals.length === 0) return true;
    for (let k = 0; k < aVals.length; k += 2) {
      const dx = aVals[k] - bVals[k];
      const dy = aVals[k + 1] - bVals[k + 1];
      const distance = Math.hypot(dx, dy);
      if (!(distance <= tolerance)) return false;
    }
    return true;
  }
  /**
   * Check if this instance has the same identity (track) as another instance.
   *
   * Mirrors Python `Instance.same_identity_as` (instance.py:755-770). Compares
   * tracks by reference identity, not by name.
   *
   * @param other - Another instance to compare with.
   * @returns `true` if both instances share the same `Track` object.
   */
  sameIdentityAs(other) {
    if (this.track == null || other.track == null) return false;
    return this.track === other.track;
  }
  /**
   * Check if this instance overlaps with another by bounding-box IoU.
   *
   * Mirrors Python `Instance.overlaps_with` (instance.py:772-830). Bounding
   * boxes are computed over VISIBLE points; if either has none, returns false.
   * If the boxes do not STRICTLY intersect on both axes (touching edges count
   * as no overlap), returns false regardless of `iouThreshold` — this matches
   * Python's `np.any(intersection_min >= intersection_max) -> False`
   * short-circuit, which runs before the threshold comparison.
   *
   * @param other - Another instance to compare with.
   * @param iouThreshold - Minimum IoU to count as overlapping (inclusive `>=`).
   */
  overlapsWith(other, iouThreshold = 0.5) {
    const boxA = this.boundingBox();
    const boxB = other.boundingBox();
    if (!boxA || !boxB) return false;
    const interMinX = Math.max(boxA[0][0], boxB[0][0]);
    const interMinY = Math.max(boxA[0][1], boxB[0][1]);
    const interMaxX = Math.min(boxA[1][0], boxB[1][0]);
    const interMaxY = Math.min(boxA[1][1], boxB[1][1]);
    if (interMinX >= interMaxX || interMinY >= interMaxY) return false;
    const interArea = (interMaxX - interMinX) * (interMaxY - interMinY);
    const areaA = (boxA[1][0] - boxA[0][0]) * (boxA[1][1] - boxA[0][1]);
    const areaB = (boxB[1][0] - boxB[0][0]) * (boxB[1][1] - boxB[0][1]);
    const union = areaA + areaB - interArea;
    const iou = union > 0 ? interArea / union : 0;
    return iou >= iouThreshold;
  }
  /**
   * Get the bounding box of visible points.
   *
   * Mirrors Python `Instance.bounding_box` (instance.py:832-849).
   *
   * @returns `[[minX, minY], [maxX, maxY]]` over visible points, or `null` if
   *   there are no visible points.
   */
  boundingBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    const xy = this._xy;
    for (let i = 0; i < this._n; i += 1) {
      if (!this._visible[i]) continue;
      const x = xy[i << 1];
      const y = xy[(i << 1) + 1];
      any = true;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (!any) return null;
    return [
      [minX, minY],
      [maxX, maxY]
    ];
  }
};
var PredictedInstance = class _PredictedInstance extends Instance {
  score;
  constructor(options) {
    const { score = 0, ...rest } = options;
    const pts = Array.isArray(rest.points) ? rest.points : predictedPointsFromDict(
      rest.points,
      rest.skeleton
    );
    super({
      points: pts,
      skeleton: rest.skeleton,
      track: rest.track,
      trackingScore: rest.trackingScore,
      fromPredicted: rest.fromPredicted,
      metadata: rest.metadata
    });
    this.score = score;
  }
  static fromArray(points, skeleton, score) {
    return new _PredictedInstance({
      points: predictedPointsFromArray(points, skeleton.nodeNames),
      skeleton,
      score
    });
  }
  static fromNumpy(options) {
    return new _PredictedInstance({
      points: predictedPointsFromArray(
        options.pointsData,
        options.skeleton.nodeNames
      ),
      skeleton: options.skeleton,
      track: options.track ?? null,
      score: options.score,
      trackingScore: options.trackingScore
    });
  }
  static empty(options) {
    return new _PredictedInstance({
      points: predictedPointsEmpty(
        options.skeleton.nodeNames.length,
        options.skeleton.nodeNames
      ),
      skeleton: options.skeleton
    });
  }
  /**
   * Build a PredictedInstance directly from reader point columns over
   * `[start, end)`, without materializing a `Point[]`. Internal fast path for
   * buildLabeledFrames; equivalent to `new PredictedInstance({ points:
   * predictedPointsFromArray(slicePoints(...)) })`.
   */
  static _fromColumns(opts) {
    const inst = Object.create(
      _PredictedInstance.prototype
    );
    inst.skeleton = opts.skeleton;
    inst.track = opts.track ?? null;
    inst.fromPredicted = opts.fromPredicted ?? null;
    inst.trackingScore = opts.trackingScore ?? 0;
    inst.score = opts.score ?? 0;
    inst.metadata = opts.metadata ?? {};
    inst._labeled = null;
    inst._fillFromColumns(opts.columns, opts.start, opts.end, true);
    return inst;
  }
  numpy(options) {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    const withScores = options?.scores ?? false;
    const xy = this._xy;
    const score = this._score;
    const out = new Array(this._n);
    for (let i = 0; i < this._n; i += 1) {
      const hidden = invisibleAsNaN && !this._visible[i];
      const x = hidden ? Number.NaN : xy[i << 1];
      const y = hidden ? Number.NaN : xy[(i << 1) + 1];
      out[i] = withScores ? [x, y, score ? score[i] : 0] : [x, y];
    }
    return out;
  }
  toString() {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `PredictedInstance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName}, score=${this.score.toFixed(2)}, tracking_score=${this.trackingScore ?? "None"})`;
  }
};
function pointsFromDict(pointsDict, skeleton) {
  const points = pointsEmpty(skeleton.nodeNames.length, skeleton.nodeNames);
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      visible: data.length > 2 ? Boolean(data[2]) : !Number.isNaN(data[0]),
      complete: data.length > 3 ? Boolean(data[3]) : false,
      name: nodeName
    };
  }
  return points;
}
function predictedPointsFromDict(pointsDict, skeleton) {
  const points = predictedPointsEmpty(
    skeleton.nodeNames.length,
    skeleton.nodeNames
  );
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      score: data[2] ?? Number.NaN,
      visible: data.length > 3 ? Boolean(data[3]) : !Number.isNaN(data[0]),
      complete: data.length > 4 ? Boolean(data[4]) : false,
      name: nodeName
    };
  }
  return points;
}

// src/model/skeleton.ts
var Node = class {
  name;
  constructor(name) {
    this.name = name;
  }
};
var Edge = class {
  source;
  destination;
  constructor(source, destination) {
    this.source = source;
    this.destination = destination;
  }
  at(index) {
    if (index === 0) return this.source;
    if (index === 1) return this.destination;
    throw new Error("Edge only has 2 nodes (source and destination).");
  }
};
var Symmetry = class {
  nodes;
  constructor(nodes) {
    const set = new Set(nodes);
    if (set.size !== 2) {
      throw new Error("Symmetry must contain exactly 2 nodes.");
    }
    this.nodes = set;
  }
  at(index) {
    let i = 0;
    for (const node of this.nodes) {
      if (i === index) return node;
      i += 1;
    }
    throw new Error("Symmetry index out of range.");
  }
};
var NAME_DELIM = "\0";
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}
function edgeKey(source, destination) {
  return source + NAME_DELIM + destination;
}
function symmetryKey(symmetry) {
  const names = Array.from(symmetry.nodes).map((node) => node.name);
  names.sort();
  return names.join(NAME_DELIM);
}
var Skeleton = class {
  nodes;
  edges;
  symmetries;
  name;
  nameToNode;
  nodeToIndex;
  constructor(options) {
    const resolved = Array.isArray(options) ? { nodes: options } : options;
    this.nodes = resolved.nodes.map(
      (node) => typeof node === "string" ? new Node(node) : node
    );
    this.edges = [];
    this.symmetries = [];
    this.name = resolved.name;
    this.nameToNode = /* @__PURE__ */ new Map();
    this.nodeToIndex = /* @__PURE__ */ new Map();
    this.rebuildCache();
    if (resolved.edges) {
      this.edges = resolved.edges.map(
        (edge) => edge instanceof Edge ? edge : this.edgeFrom(edge)
      );
    }
    if (resolved.symmetries) {
      this.symmetries = resolved.symmetries.map(
        (symmetry) => symmetry instanceof Symmetry ? symmetry : this.symmetryFrom(symmetry)
      );
    }
  }
  rebuildCache(nodes = this.nodes) {
    this.nameToNode = new Map(nodes.map((node) => [node.name, node]));
    this.nodeToIndex = new Map(nodes.map((node, index) => [node, index]));
  }
  get nodeNames() {
    return this.nodes.map((node) => node.name);
  }
  index(node) {
    if (typeof node === "number") return node;
    if (typeof node === "string") {
      const found = this.nameToNode.get(node);
      if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
      return this.nodeToIndex.get(found) ?? -1;
    }
    const idx = this.nodeToIndex.get(node);
    if (idx === void 0) throw new Error("Node not found in skeleton.");
    return idx;
  }
  node(node) {
    if (node instanceof Node) return node;
    if (typeof node === "number") return this.nodes[node];
    const found = this.nameToNode.get(node);
    if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
    return found;
  }
  get edgeIndices() {
    return this.edges.map((edge) => [
      this.index(edge.source),
      this.index(edge.destination)
    ]);
  }
  get symmetryNames() {
    return this.symmetries.map((symmetry) => {
      const nodes = Array.from(symmetry.nodes).map((node) => node.name);
      return [nodes[0], nodes[1]];
    });
  }
  /**
   * Check if this skeleton matches another skeleton's structure.
   *
   * Two skeletons match if they have the same nodes (by name), the same edges
   * (by directed source/destination name pairs), and the same symmetries (by
   * unordered node-name pairs). All comparisons are by node NAME, never by Node
   * identity. Two empty skeletons match.
   *
   * @param other Another skeleton to compare with.
   * @param opts.requireSameOrder If true, node names must be in the same order;
   *   if false (default), only the set of node names must match. Affects ONLY
   *   the node-name check — edges and symmetries are always compared as
   *   unordered sets.
   * @returns True if the skeletons match, false otherwise.
   */
  matches(other, opts = {}) {
    const requireSameOrder = opts.requireSameOrder ?? false;
    if (this.nodes.length !== other.nodes.length) return false;
    const selfNames = this.nodeNames;
    const otherNames = other.nodeNames;
    if (requireSameOrder) {
      for (let i = 0; i < selfNames.length; i += 1) {
        if (selfNames[i] !== otherNames[i]) return false;
      }
    } else {
      if (!setsEqual(new Set(selfNames), new Set(otherNames))) return false;
    }
    if (this.edges.length !== other.edges.length) return false;
    const selfEdgeSet = new Set(
      this.edges.map(
        (edge) => edgeKey(edge.source.name, edge.destination.name)
      )
    );
    const otherEdgeSet = new Set(
      other.edges.map(
        (edge) => edgeKey(edge.source.name, edge.destination.name)
      )
    );
    if (!setsEqual(selfEdgeSet, otherEdgeSet)) return false;
    if (this.symmetries.length !== other.symmetries.length) return false;
    const selfSymSet = new Set(this.symmetries.map(symmetryKey));
    const otherSymSet = new Set(other.symmetries.map(symmetryKey));
    return setsEqual(selfSymSet, otherSymSet);
  }
  /**
   * Calculate node overlap metrics with another skeleton.
   *
   * Node names are de-duplicated to sets first.
   *
   * @param other Another skeleton to compare with.
   * @returns An object with similarity metrics:
   *   - `nCommon`: Number of nodes in common.
   *   - `nSelfOnly`: Number of nodes only in this skeleton.
   *   - `nOtherOnly`: Number of nodes only in the other skeleton.
   *   - `jaccard`: Jaccard similarity (intersection/union), 0 if union empty.
   *   - `dice`: Dice coefficient (2*intersection/(nSelf+nOther)), 0 if both empty.
   */
  nodeSimilarities(other) {
    const selfNodes = new Set(this.nodeNames);
    const otherNodes = new Set(other.nodeNames);
    let nCommon = 0;
    for (const name of selfNodes) {
      if (otherNodes.has(name)) nCommon += 1;
    }
    const sizeSelf = selfNodes.size;
    const sizeOther = otherNodes.size;
    const nSelfOnly = sizeSelf - nCommon;
    const nOtherOnly = sizeOther - nCommon;
    const nUnion = sizeSelf + sizeOther - nCommon;
    const jaccard = nUnion > 0 ? nCommon / nUnion : 0;
    const dice = sizeSelf + sizeOther > 0 ? 2 * nCommon / (sizeSelf + sizeOther) : 0;
    return { nCommon, nSelfOnly, nOtherOnly, jaccard, dice };
  }
  addEdge(source, destination) {
    this.edges.push(new Edge(this.node(source), this.node(destination)));
  }
  addSymmetry(left, right) {
    this.symmetries.push(new Symmetry([this.node(left), this.node(right)]));
  }
  edgeFrom(edge) {
    const [source, destination] = edge;
    return new Edge(this.node(source), this.node(destination));
  }
  symmetryFrom(symmetry) {
    const [a, b] = symmetry;
    return new Symmetry([this.node(a), this.node(b)]);
  }
};

// src/model/source-mark.ts
var marks = /* @__PURE__ */ new WeakMap();
var ACCESS_RANK = {
  edit: 0,
  keep: 1,
  view: 2
};
function sourceMarkOf(record) {
  return record ? marks.get(record) : void 0;
}
function markSource(record, sourceFormat) {
  if (record && sourceFormat) marks.set(record, sourceFormat);
}
function copySourceMark(from, to) {
  const mark = sourceMarkOf(from);
  if (mark && to) marks.set(to, mark);
}
function takeViewMark(target, source) {
  const incoming = sourceMarkOf(source);
  if (target && incoming?.access === "view") marks.set(target, incoming);
}
function sessionRecords(sessions) {
  const records = [];
  for (const session of sessions) {
    for (const group of session.frameGroups.values()) {
      records.push(group, ...group.instanceGroups);
    }
  }
  return records;
}
function markSessionSource(sessions, sourceFormat) {
  if (!sourceFormat) return;
  for (const record of sessionRecords(sessions)) {
    markSource(record, sourceFormat);
  }
}
function markFrameSource(frame, sourceFormat) {
  if (!sourceFormat) return;
  markSource(frame, sourceFormat);
  for (const list of [
    frame.instances,
    frame.centroids,
    frame.bboxes,
    frame.masks,
    frame.labelImages,
    frame.rois
  ]) {
    for (const record of list) markSource(record, sourceFormat);
  }
}
function keepSourceMark(from, out) {
  if (Array.isArray(out)) {
    for (const record of out) copySourceMark(from, record);
  } else {
    copySourceMark(from, out);
  }
  return out;
}
function markFromSources(target, sources) {
  let strictest;
  for (const source of sources) {
    const mark = sourceMarkOf(source);
    if (!mark) continue;
    if (!strictest || ACCESS_RANK[mark.access] > ACCESS_RANK[strictest.access]) {
      strictest = mark;
    }
  }
  if (strictest) marks.set(target, strictest);
}
function setSourceAccess(labels, access) {
  if (access !== "keep" && access !== "view" && access !== "edit") {
    throw new TypeError(
      `access must be "keep", "view" or "edit", got ${JSON.stringify(access)}.`
    );
  }
  const switched = /* @__PURE__ */ new Map();
  const switchedTo = (old) => {
    if (old.access === access) return old;
    let next = switched.get(old);
    if (!next) {
      next = Object.freeze({ ...old, access });
      switched.set(old, next);
    }
    return next;
  };
  let count = 0;
  const swap = (record) => {
    const old = marks.get(record);
    if (!old || old.access === access) return;
    marks.set(record, switchedTo(old));
    count += 1;
  };
  const swapFrame = (frame) => {
    swap(frame);
    for (const list of [
      frame.instances,
      frame.centroids,
      frame.bboxes,
      frame.masks,
      frame.labelImages,
      frame.rois
    ]) {
      for (const record of list) swap(record);
    }
  };
  if (labels.sourceFormat)
    labels.sourceFormat = switchedTo(labels.sourceFormat);
  for (const frame of labels.labeledFrames) swapFrame(frame);
  for (const roi of labels._staticRois) swap(roi);
  for (const record of sessionRecords(labels.sessions)) swap(record);
  const store = labels._lazyDataStore;
  if (store) {
    if (store.sourceFormat) store.sourceFormat = switchedTo(store.sourceFormat);
    for (const [byFrame, undistributed] of [
      [store._centroidByFrame, store._undistributedCentroids],
      [store._bboxByFrame, store._undistributedBboxes],
      [store._maskByFrame, store._undistributedMasks],
      [store._roiByFrame, store._undistributedRois],
      [store._labelImageByFrame, store._undistributedLabelImages]
    ]) {
      for (const record of undistributed) swap(record);
      for (const list of byFrame.values()) {
        for (const record of list) swap(record);
      }
    }
  }
  const lazyFrames = labels._lazyFrameList;
  if (lazyFrames) {
    for (const frame of lazyFrames._supplementary) swapFrame(frame);
    for (const frame of lazyFrames._cachedFrames()) swapFrame(frame);
  }
  return count;
}

// src/video/jpeg-encode.ts
var DEFAULT_JPEG_QUALITY = 95;
var ZIGZAG = [
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63
];
var LUMA_QUANT = [
  16,
  11,
  10,
  16,
  24,
  40,
  51,
  61,
  12,
  12,
  14,
  19,
  26,
  58,
  60,
  55,
  14,
  13,
  16,
  24,
  40,
  57,
  69,
  56,
  14,
  17,
  22,
  29,
  51,
  87,
  80,
  62,
  18,
  22,
  37,
  56,
  68,
  109,
  103,
  77,
  24,
  35,
  55,
  64,
  81,
  104,
  113,
  92,
  49,
  64,
  78,
  87,
  103,
  121,
  120,
  101,
  72,
  92,
  95,
  98,
  112,
  100,
  103,
  99
];
var CHROMA_QUANT = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99
];
var LUMA_DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
var CHROMA_DC_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
var DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var LUMA_AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
var LUMA_AC_VALS = [
  1,
  2,
  3,
  0,
  4,
  17,
  5,
  18,
  33,
  49,
  65,
  6,
  19,
  81,
  97,
  7,
  34,
  113,
  20,
  50,
  129,
  145,
  161,
  8,
  35,
  66,
  177,
  193,
  21,
  82,
  209,
  240,
  36,
  51,
  98,
  114,
  130,
  9,
  10,
  22,
  23,
  24,
  25,
  26,
  37,
  38,
  39,
  40,
  41,
  42,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  67,
  68,
  69,
  70,
  71,
  72,
  73,
  74,
  83,
  84,
  85,
  86,
  87,
  88,
  89,
  90,
  99,
  100,
  101,
  102,
  103,
  104,
  105,
  106,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
  122,
  131,
  132,
  133,
  134,
  135,
  136,
  137,
  138,
  146,
  147,
  148,
  149,
  150,
  151,
  152,
  153,
  154,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  178,
  179,
  180,
  181,
  182,
  183,
  184,
  185,
  186,
  194,
  195,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  210,
  211,
  212,
  213,
  214,
  215,
  216,
  217,
  218,
  225,
  226,
  227,
  228,
  229,
  230,
  231,
  232,
  233,
  234,
  241,
  242,
  243,
  244,
  245,
  246,
  247,
  248,
  249,
  250
];
var CHROMA_AC_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
var CHROMA_AC_VALS = [
  0,
  1,
  2,
  3,
  17,
  4,
  5,
  33,
  49,
  6,
  18,
  65,
  81,
  7,
  97,
  113,
  19,
  34,
  50,
  129,
  8,
  20,
  66,
  145,
  161,
  177,
  193,
  9,
  35,
  51,
  82,
  240,
  21,
  98,
  114,
  209,
  10,
  22,
  36,
  52,
  225,
  37,
  241,
  23,
  24,
  25,
  26,
  38,
  39,
  40,
  41,
  42,
  53,
  54,
  55,
  56,
  57,
  58,
  67,
  68,
  69,
  70,
  71,
  72,
  73,
  74,
  83,
  84,
  85,
  86,
  87,
  88,
  89,
  90,
  99,
  100,
  101,
  102,
  103,
  104,
  105,
  106,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
  122,
  130,
  131,
  132,
  133,
  134,
  135,
  136,
  137,
  138,
  146,
  147,
  148,
  149,
  150,
  151,
  152,
  153,
  154,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  178,
  179,
  180,
  181,
  182,
  183,
  184,
  185,
  186,
  194,
  195,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  210,
  211,
  212,
  213,
  214,
  215,
  216,
  217,
  218,
  226,
  227,
  228,
  229,
  230,
  231,
  232,
  233,
  234,
  242,
  243,
  244,
  245,
  246,
  247,
  248,
  249,
  250
];
function huffmanTable(bits, vals) {
  const codes = new Int32Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      codes[vals[k]] = code++;
      lengths[vals[k++]] = len;
    }
    code <<= 1;
  }
  return [codes, lengths];
}
function scaledQuant(base, quality) {
  const q = Math.min(100, Math.max(1, Math.trunc(quality)));
  const scale = q < 50 ? Math.floor(5e3 / q) : 200 - q * 2;
  return Float64Array.from(
    base,
    (v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100)))
  );
}
var DCT_BASIS = Float64Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3;
  const x = i & 7;
  return 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * x + 1) * u * Math.PI / 16);
});
function encodeJpegPixels(pixels, width, height, channels, quality = null) {
  if (!(channels >= 1 && channels <= 4 && Number.isInteger(channels))) {
    throw new Error(
      `Cannot JPEG-encode a frame with ${channels} channels (expected 1-4).`
    );
  }
  if (!(width >= 1 && height >= 1 && width <= 65535 && height <= 65535)) {
    throw new Error(`Cannot JPEG-encode a ${width}x${height} frame.`);
  }
  if (pixels.length !== width * height * channels) {
    throw new Error(
      `Cannot JPEG-encode a ${width}x${height} frame with ${channels} channel(s): expected ${width * height * channels} bytes, got ${pixels.length}.`
    );
  }
  const q = quality ?? DEFAULT_JPEG_QUALITY;
  const colour = channels >= 3;
  const quants = colour ? [scaledQuant(LUMA_QUANT, q), scaledQuant(CHROMA_QUANT, q)] : [scaledQuant(LUMA_QUANT, q)];
  const dcTables = [huffmanTable(LUMA_DC_BITS, DC_VALS)];
  const acTables = [huffmanTable(LUMA_AC_BITS, LUMA_AC_VALS)];
  if (colour) {
    dcTables.push(huffmanTable(CHROMA_DC_BITS, DC_VALS));
    acTables.push(huffmanTable(CHROMA_AC_BITS, CHROMA_AC_VALS));
  }
  const mcu = colour ? 16 : 8;
  const pw = Math.ceil(width / mcu) * mcu;
  const ph = Math.ceil(height / mcu) * mcu;
  const lum = new Float64Array(pw * ph);
  const cw = pw >> 1;
  const cb = colour ? new Float64Array(cw * (ph >> 1)) : null;
  const cr = colour ? new Float64Array(cw * (ph >> 1)) : null;
  for (let y = 0; y < ph; y++) {
    const row = Math.min(y, height - 1) * width;
    for (let x = 0; x < pw; x++) {
      const i = (row + Math.min(x, width - 1)) * channels;
      if (!colour) {
        lum[y * pw + x] = pixels[i] - 128;
        continue;
      }
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      lum[y * pw + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      const c = (y >> 1) * cw + (x >> 1);
      cb[c] += 0.25 * (-0.168736 * r - 0.331264 * g + 0.5 * b);
      cr[c] += 0.25 * (0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }
  let out = new Uint8Array(1024 + (width * height * channels >> 2));
  let pos = 0;
  const byte = (b) => {
    if (pos === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[pos++] = b;
  };
  const segment = (marker, payload) => {
    byte(255);
    byte(marker);
    byte(payload.length + 2 >> 8);
    byte(payload.length + 2 & 255);
    for (const b of payload) byte(b);
  };
  byte(255);
  byte(216);
  segment(224, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt = [];
  quants.forEach((table, t) => {
    dqt.push(t);
    for (const n of ZIGZAG) dqt.push(table[n]);
  });
  segment(219, dqt);
  const sof = [8, height >> 8, height & 255, width >> 8, width & 255];
  sof.push(colour ? 3 : 1, 1, colour ? 34 : 17, 0);
  if (colour) sof.push(2, 17, 1, 3, 17, 1);
  segment(192, sof);
  const dht = [0, ...LUMA_DC_BITS, ...DC_VALS];
  dht.push(16, ...LUMA_AC_BITS, ...LUMA_AC_VALS);
  if (colour) {
    dht.push(1, ...CHROMA_DC_BITS, ...DC_VALS);
    dht.push(17, ...CHROMA_AC_BITS, ...CHROMA_AC_VALS);
  }
  segment(196, dht);
  segment(
    218,
    colour ? [3, 1, 0, 2, 17, 3, 17, 0, 63, 0] : [1, 1, 0, 0, 63, 0]
  );
  let acc = 0;
  let nbits = 0;
  const put = (code, len) => {
    acc = acc << len | code;
    nbits += len;
    while (nbits >= 8) {
      const b = acc >> nbits - 8 & 255;
      byte(b);
      if (b === 255) byte(0);
      nbits -= 8;
    }
    acc &= (1 << nbits) - 1;
  };
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const coef = new Int32Array(64);
  const prevDc = [0, 0, 0];
  const encodeBlock = (plane, stride, bx, by, comp) => {
    const t = comp === 0 ? 0 : 1;
    const quant = quants[t];
    const [dcCodes, dcLengths] = dcTables[t];
    const [acCodes, acLengths] = acTables[t];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        block[y * 8 + x] = plane[(by + y) * stride + bx + x];
      }
    }
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++)
          s += DCT_BASIS[u * 8 + x] * block[y * 8 + x];
        tmp[y * 8 + u] = s;
      }
    }
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += DCT_BASIS[v * 8 + y] * tmp[y * 8 + u];
        coef[v * 8 + u] = Math.round(s / quant[v * 8 + u]);
      }
    }
    let value = coef[0] - prevDc[comp];
    prevDc[comp] = coef[0];
    let cat = 0;
    for (let a = Math.abs(value); a > 0; a >>= 1) cat++;
    put(dcCodes[cat], dcLengths[cat]);
    if (cat > 0) put(value < 0 ? value + (1 << cat) - 1 : value, cat);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      value = coef[ZIGZAG[k]];
      if (value === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        put(acCodes[240], acLengths[240]);
        run -= 16;
      }
      cat = 0;
      for (let a = Math.abs(value); a > 0; a >>= 1) cat++;
      const sym = run << 4 | cat;
      put(acCodes[sym], acLengths[sym]);
      put(value < 0 ? value + (1 << cat) - 1 : value, cat);
      run = 0;
    }
    if (run > 0) put(acCodes[0], acLengths[0]);
  };
  for (let my = 0; my < ph; my += mcu) {
    for (let mx = 0; mx < pw; mx += mcu) {
      if (!colour) {
        encodeBlock(lum, pw, mx, my, 0);
        continue;
      }
      encodeBlock(lum, pw, mx, my, 0);
      encodeBlock(lum, pw, mx + 8, my, 0);
      encodeBlock(lum, pw, mx, my + 8, 0);
      encodeBlock(lum, pw, mx + 8, my + 8, 0);
      encodeBlock(cb, cw, mx >> 1, my >> 1, 1);
      encodeBlock(cr, cw, mx >> 1, my >> 1, 2);
    }
  }
  if (nbits > 0) put((1 << 8 - nbits) - 1, 8 - nbits);
  byte(255);
  byte(217);
  return out.slice(0, pos);
}

// src/video/png-encode.ts
import { deflate } from "pako";
var COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };
function encodePngPixels(pixels, width, height, channels, compressLevel = null) {
  const colorType = COLOR_TYPE[channels];
  if (colorType === void 0) {
    throw new Error(
      `Cannot PNG-encode a frame with ${channels} channels (expected 1\u20134).`
    );
  }
  const stride = width * channels;
  if (pixels.length !== stride * height) {
    throw new Error(
      `Cannot PNG-encode a ${width}x${height} frame with ${channels} channel(s): expected ${stride * height} bytes, got ${pixels.length}.`
    );
  }
  const raw = subFilterScanlines(pixels, width, height, channels);
  const compressed = deflate(
    raw,
    compressLevel == null ? { level: 1, strategy: Z_RLE } : {
      level: Math.min(9, Math.max(0, compressLevel))
    }
  );
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10
  ]);
  const chunks = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0))
  ];
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
var Z_RLE = 3;
function subFilterScanlines(pixels, width, height, channels) {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    const r = y * stride;
    out[o] = 1;
    for (let i = 0; i < channels; i++) out[o + 1 + i] = pixels[r + i];
    for (let i = channels; i < stride; i++) {
      out[o + 1 + i] = pixels[r + i] - pixels[r + i - channels] & 255;
    }
  }
  return out;
}
function pngChunk(type, data) {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ]);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}
var CRC_TABLE = null;
function crc32(bytes) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 4294967295;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}

// src/video/image-decode.ts
function isBgrOrder(channelOrder) {
  return typeof channelOrder === "string" && channelOrder.toUpperCase() === "BGR";
}
function encodedChannelCount(bytes) {
  const png = bytes.length >= 26 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  if (png) {
    const colorType = bytes[25];
    if (colorType === 0) return 1;
    if (colorType === 2) return 3;
    if (colorType === 4) return 2;
    if (colorType === 6) return 4;
    if (colorType === 3) return pngHasChunk(bytes, "tRNS") ? 4 : 3;
    return null;
  }
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!jpeg) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 255) return null;
    const marker = bytes[i + 1];
    if (marker === 255) {
      i += 1;
      continue;
    }
    const length = bytes[i + 2] << 8 | bytes[i + 3];
    const isSof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
    if (isSof) return i + 9 < bytes.length ? bytes[i + 9] : null;
    if (marker === 218 || marker === 217) return null;
    i += 2 + length;
  }
  return null;
}
function pngHasChunk(bytes, type) {
  let i = 8;
  while (i + 8 <= bytes.length) {
    const length = (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
    const name = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7]
    );
    if (name === type) return true;
    if (name === "IDAT" || name === "IEND") return false;
    i += 12 + length;
  }
  return false;
}
function needsRedBlueSwap(bytes, channelOrder) {
  return isBgrOrder(channelOrder) && encodedChannelCount(bytes) === 3;
}
function swapRedBlue(data, channels) {
  if (channels < 3) return;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i];
    data[i] = data[i + 2];
    data[i + 2] = r;
  }
}
async function rasterizeBitmap(bitmap) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context to rasterize a frame");
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  try {
    const sc = await import("skia-canvas");
    const Canvas = sc.Canvas;
    const canvas = new Canvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (err) {
    throw new Error(
      `Rasterizing a frame returned as an ImageBitmap requires an image rasterizer (a browser with OffscreenCanvas, or the optional \`skia-canvas\` package on Node). Original error: ${err.message}`
    );
  }
}
function isImageBitmapLike(value) {
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    return true;
  }
  const v = value;
  return v != null && typeof v.width === "number" && typeof v.height === "number" && typeof v.close === "function" && v.data === void 0;
}
function isImageDataLike(value) {
  const v = value;
  return v != null && typeof v.width === "number" && typeof v.height === "number" && (v.data instanceof Uint8ClampedArray || v.data instanceof Uint8Array);
}
async function encodeImageDataToPng(img) {
  const { data, width, height } = img;
  const explicit = "channels" in img ? img.channels : void 0;
  const pixels = width * height;
  if (explicit === void 0 && data.length === pixels * 4) {
    const rgb = new Uint8Array(pixels * 3);
    for (let p = 0, i = 0, o = 0; p < pixels; p++, i += 4, o += 3) {
      rgb[o] = data[i];
      rgb[o + 1] = data[i + 1];
      rgb[o + 2] = data[i + 2];
    }
    return encodePngPixels(rgb, width, height, 3);
  }
  return encodePngPixels(data, width, height, explicit ?? data.length / pixels);
}
async function encodeBitmapToPng(bitmap) {
  return encodeImageDataToPng(await rasterizeBitmap(bitmap));
}
function isEncodedBytes(bytes) {
  if (bytes.length < 4) return false;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  return jpeg || png;
}
async function toReadableFrame(frame, rawShape, channelOrder) {
  if (isImageBitmapLike(frame)) {
    return rasterizeBitmap(frame);
  }
  if (isImageDataLike(frame)) {
    return frame;
  }
  const bytes = frame instanceof ArrayBuffer ? new Uint8Array(frame) : frame;
  if (isEncodedBytes(bytes)) {
    return decodeEncoded(bytes, channelOrder);
  }
  if (!rawShape) {
    throw new Error(
      "toReadableFrame received raw pixel bytes but no shape was given to interpret them. Provide the producing backend's resolved shape."
    );
  }
  const [, height, width, channels] = rawShape;
  return { data: bytes, width, height, channels };
}
async function decodeEncoded(bytes, channelOrder) {
  const img = await decodeEncodedPixels(bytes);
  if (needsRedBlueSwap(bytes, channelOrder)) swapRedBlue(img.data, 4);
  return img;
}
async function decodeEncodedPixels(bytes) {
  if (typeof createImageBitmap !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    const safe = new Uint8Array(bytes);
    const bitmap = await createImageBitmap(new Blob([safe.buffer]));
    return rasterizeBitmap(bitmap);
  }
  try {
    const sc = await import("skia-canvas");
    const src = typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes;
    const img = await sc.loadImage(src);
    const Canvas = sc.Canvas;
    const canvas = new Canvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } catch (err) {
    throw new Error(
      `Decoding undecoded JPEG/PNG image bytes requires an image decoder (a browser, or the optional \`skia-canvas\` package on Node). Original error: ${err.message}`
    );
  }
}
function isBrowserWindow() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
async function decodeEmbeddedImage(bytes, format, channelOrder) {
  if (!isBrowserWindow() || typeof createImageBitmap === "undefined") {
    return null;
  }
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  if (!isBgrOrder(channelOrder)) return bitmap;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get a 2D context to decode a BGR frame");
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  swapRedBlue(imageData.data, 4);
  return imageData;
}
function decodeEmbeddedRaw(bytes, shape, channelOrder) {
  if (!isBrowserWindow() || !shape) return null;
  const [, height, width, channels] = shape;
  if (!height || !width || !channels) return null;
  const expectedLength = height * width * channels;
  if (bytes.length < expectedLength) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const useBgr = isBgrOrder(channelOrder);
  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    const r = bytes[base + (useBgr ? 2 : 0)] ?? 0;
    const g = bytes[base + 1] ?? 0;
    const b = bytes[base + (useBgr ? 0 : 2)] ?? 0;
    const a = channels === 4 ? bytes[base + 3] ?? 255 : 255;
    const out = i * 4;
    rgba[out] = r;
    rgba[out + 1] = g;
    rgba[out + 2] = b;
    rgba[out + 3] = a;
  }
  return new ImageData(rgba, width, height);
}

// src/model/preview.ts
var PREVIEW_FORMAT_VERSION = 1;
var DEFAULT_PREVIEW_MAX_SIZE = 768;
var DEFAULT_PREVIEW_QUALITY = 80;
var PreviewFrame = class {
  video;
  frameIdx;
  origWidth;
  origHeight;
  width;
  height;
  data;
  constructor(options) {
    this.video = options.video;
    this.frameIdx = Math.trunc(options.frameIdx);
    this.origWidth = Math.trunc(options.origWidth);
    this.origHeight = Math.trunc(options.origHeight);
    this.width = Math.trunc(options.width);
    this.height = Math.trunc(options.height);
    this.data = options.data;
  }
};
function downscaleArea(src, srcW, srcH, channels, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH * channels);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = dy * scaleY;
    const sy1 = Math.min(srcH, (dy + 1) * scaleY);
    const iy0 = Math.floor(sy0);
    const iy1 = Math.min(srcH - 1, Math.ceil(sy1) - 1);
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = dx * scaleX;
      const sx1 = Math.min(srcW, (dx + 1) * scaleX);
      const ix0 = Math.floor(sx0);
      const ix1 = Math.min(srcW - 1, Math.ceil(sx1) - 1);
      const dstBase = (dy * dstW + dx) * channels;
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let weightSum = 0;
        for (let sy = iy0; sy <= iy1; sy++) {
          const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
          if (wy <= 0) continue;
          const rowOff = sy * srcW * channels;
          for (let sx = ix0; sx <= ix1; sx++) {
            const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            if (wx <= 0) continue;
            const w = wx * wy;
            sum += src[rowOff + sx * channels + c] * w;
            weightSum += w;
          }
        }
        dst[dstBase + c] = weightSum > 0 ? Math.min(255, Math.max(0, Math.round(sum / weightSum))) : 0;
      }
    }
  }
  return dst;
}
function normalizePreviewChannels(pixels, width, height, channels) {
  const n = width * height;
  if (channels === 1) {
    return {
      data: pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      channels: 1
    };
  }
  if (channels === 2) {
    const gray = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 2) gray[p] = pixels[i];
    return { data: gray, channels: 1 };
  }
  let isGray = true;
  for (let p = 0, i = 0; p < n; p++, i += channels) {
    const r = pixels[i];
    if (pixels[i + 1] !== r || pixels[i + 2] !== r) {
      isGray = false;
      break;
    }
  }
  if (isGray) {
    const gray = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += channels) gray[p] = pixels[i];
    return { data: gray, channels: 1 };
  }
  if (channels === 3) {
    return {
      data: pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      channels: 3
    };
  }
  const rgb = new Uint8Array(n * 3);
  for (let p = 0, i = 0, o = 0; p < n; p++, i += channels, o += 3) {
    rgb[o] = pixels[i];
    rgb[o + 1] = pixels[i + 1];
    rgb[o + 2] = pixels[i + 2];
  }
  return { data: rgb, channels: 3 };
}
function encodePreviewJpeg(pixels, origWidth, origHeight, channels, options) {
  const maxSize = options?.maxSize ?? DEFAULT_PREVIEW_MAX_SIZE;
  const quality = Math.min(
    100,
    Math.max(1, Math.trunc(options?.quality ?? DEFAULT_PREVIEW_QUALITY))
  );
  const normalized = normalizePreviewChannels(
    pixels,
    origWidth,
    origHeight,
    channels
  );
  let width = origWidth;
  let height = origHeight;
  let data = normalized.data;
  const longEdge = Math.max(origWidth, origHeight);
  if (maxSize > 0 && longEdge > maxSize) {
    const scale = maxSize / longEdge;
    width = Math.max(1, Math.round(origWidth * scale));
    height = Math.max(1, Math.round(origHeight * scale));
    data = downscaleArea(
      data,
      origWidth,
      origHeight,
      normalized.channels,
      width,
      height
    );
  }
  const jpeg = encodeJpegPixels(
    data,
    width,
    height,
    normalized.channels,
    quality
  );
  return { width, height, data: jpeg };
}
function createPreviewFrameFromPixels(video, frameIdx, pixels, origWidth, origHeight, channels, options) {
  const encoded = encodePreviewJpeg(
    pixels,
    origWidth,
    origHeight,
    channels,
    options
  );
  return new PreviewFrame({
    video,
    frameIdx,
    origWidth,
    origHeight,
    width: encoded.width,
    height: encoded.height,
    data: encoded.data
  });
}
async function createPreviewFrameFromVideoFrame(video, frameIdx, frame, options) {
  const readable = await toReadableFrame(
    frame,
    options?.rawShape ?? video.shape ?? void 0,
    options?.channelOrder ?? video.backend?.embeddedChannelOrder
  );
  const { width, height, data } = readable;
  const explicitCh = "channels" in readable ? readable.channels : void 0;
  const channels = explicitCh ?? (data.length === width * height * 4 ? 4 : data.length / (width * height));
  return createPreviewFrameFromPixels(
    video,
    frameIdx,
    data,
    width,
    height,
    channels,
    options
  );
}

// src/model/camera.ts
function rodriguesTransformation(input) {
  if (input.length === 3 && Array.isArray(input[0]) === false) {
    const rvec = input;
    const theta2 = Math.hypot(rvec[0], rvec[1], rvec[2]);
    if (theta2 === 0) {
      return {
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ],
        vector: rvec
      };
    }
    const axis = rvec.map((v) => v / theta2);
    const [x, y, z] = axis;
    const cos = Math.cos(theta2);
    const sin = Math.sin(theta2);
    const K = [
      [0, -z, y],
      [z, 0, -x],
      [-y, x, 0]
    ];
    const I = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    const KK = multiply3x3(K, K);
    const matrix2 = add3x3(add3x3(I, scale3x3(K, sin)), scale3x3(KK, 1 - cos));
    return { matrix: matrix2, vector: rvec };
  }
  const matrix = input;
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
function multiply3x3(a, b) {
  const result = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      result[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return result;
}
function add3x3(a, b) {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}
function scale3x3(a, scale) {
  return a.map((row) => row.map((val) => val * scale));
}
var Camera = class {
  name;
  rvec;
  tvec;
  matrix;
  distortions;
  size;
  constructor(options) {
    this.name = options.name;
    this.rvec = options.rvec;
    this.tvec = options.tvec;
    this.matrix = options.matrix;
    this.distortions = options.distortions;
    this.size = options.size;
  }
};
var CameraGroup = class {
  cameras;
  metadata;
  constructor(options) {
    this.cameras = options?.cameras ?? [];
    this.metadata = options?.metadata ?? {};
  }
};
var InstanceGroup = class {
  score;
  identity;
  instance3d;
  metadata;
  _points;
  /**
   * The CONCRETE camera→instance map. Set for in-memory construction and for the
   * JS-inline read path (point-dict instances). `undefined` for a pure-ref group
   * read from a camcorder-format file until first access resolves the refs. Read
   * directly (not via the caching getter) by the write path.
   * @internal
   */
  _instanceByCamera;
  /**
   * Verbatim as-read index refs from `camcorder_to_lf_and_inst_idx_map`:
   * camera → [globalLabeledFrameIdx, instanceIdx]. Captured on read WITHOUT
   * materializing any frames, so an untouched group can be written back
   * losslessly (see hybrid write-back). `undefined` for in-memory groups.
   * @internal
   */
  _instanceRefsByCamera;
  constructor(options) {
    if (options.instanceByCamera !== void 0) {
      if (options.instanceByCamera instanceof Map) {
        this._instanceByCamera = options.instanceByCamera;
      } else {
        const map = /* @__PURE__ */ new Map();
        for (const [key, value] of Object.entries(options.instanceByCamera)) {
          map.set(key, value);
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
  get points() {
    if (this.instance3d?.points) return this.instance3d.points;
    return this._points;
  }
  set points(value) {
    if (this.instance3d?.points && value != null) {
      console.warn(
        "Setting points on an InstanceGroup that has an Instance3D \u2014 the getter will return instance3d.points, not this value. Set instance3d.points directly instead."
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
  get instanceByCamera() {
    if (this._instanceByCamera) return this._instanceByCamera;
    const refs = this._instanceRefsByCamera;
    const resolver = this._frameResolver;
    if (refs && resolver) {
      const map = /* @__PURE__ */ new Map();
      for (const [camera, [lfIdx, instIdx]] of refs) {
        const lf = resolver(lfIdx);
        const inst = lf?.instances[instIdx];
        if (inst) map.set(camera, inst);
      }
      this._instanceByCamera = map;
      return map;
    }
    return /* @__PURE__ */ new Map();
  }
  set instanceByCamera(value) {
    this._instanceByCamera = value;
  }
  get instances() {
    return Array.from(this.instanceByCamera.values());
  }
};
var FrameGroup = class {
  frameIdx;
  instanceGroups;
  metadata;
  /**
   * The CONCRETE camera→labeledFrame map. Set for in-memory construction;
   * `undefined` for a pure-ref group read from a camcorder-format file until
   * first access resolves the refs. Read directly (not via the caching getter)
   * by the write path.
   * @internal
   */
  _labeledFrameByCamera;
  /**
   * Verbatim as-read index refs from `labeled_frame_by_camera` (or reconstructed
   * from `camcorder_to_lf_and_inst_idx_map`): camera → globalLabeledFrameIdx.
   * Captured on read WITHOUT materializing any frames. `undefined` for in-memory
   * groups.
   * @internal
   */
  _labeledFrameRefsByCamera;
  constructor(options) {
    this.frameIdx = options.frameIdx;
    this.instanceGroups = options.instanceGroups;
    if (options.labeledFrameByCamera !== void 0) {
      if (options.labeledFrameByCamera instanceof Map) {
        this._labeledFrameByCamera = options.labeledFrameByCamera;
      } else {
        const map = /* @__PURE__ */ new Map();
        for (const [key, value] of Object.entries(
          options.labeledFrameByCamera
        )) {
          map.set(key, value);
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
  get labeledFrameByCamera() {
    if (this._labeledFrameByCamera) return this._labeledFrameByCamera;
    const refs = this._labeledFrameRefsByCamera;
    const resolver = this._frameResolver;
    if (refs && resolver) {
      const map = /* @__PURE__ */ new Map();
      for (const [camera, lfIdx] of refs) {
        const lf = resolver(lfIdx);
        if (lf) map.set(camera, lf);
      }
      this._labeledFrameByCamera = map;
      return map;
    }
    return /* @__PURE__ */ new Map();
  }
  set labeledFrameByCamera(value) {
    this._labeledFrameByCamera = value;
  }
  /**
   * Cameras participating in this frame group. Reads keys from whichever backing
   * map exists WITHOUT resolving refs, so listing cameras never materializes a
   * frame (crucial for the lazy/zero-materialization write path).
   */
  get cameras() {
    return Array.from(
      (this._labeledFrameByCamera ?? this._labeledFrameRefsByCamera ?? /* @__PURE__ */ new Map()).keys()
    );
  }
  get labeledFrames() {
    return Array.from(this.labeledFrameByCamera.values());
  }
  getFrame(camera) {
    return this.labeledFrameByCamera.get(camera);
  }
};
var RecordingSession = class {
  cameraGroup;
  frameGroupByFrameIdx;
  videoByCamera;
  cameraByVideo;
  metadata;
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
  rawJson;
  constructor(options) {
    this.cameraGroup = options?.cameraGroup ?? new CameraGroup();
    this.frameGroupByFrameIdx = options?.frameGroupByFrameIdx ?? /* @__PURE__ */ new Map();
    this.videoByCamera = options?.videoByCamera ?? /* @__PURE__ */ new Map();
    this.cameraByVideo = options?.cameraByVideo ?? /* @__PURE__ */ new Map();
    this.metadata = options?.metadata ?? {};
    this.rawJson = options?.rawJson;
  }
  get frameGroups() {
    return this.frameGroupByFrameIdx;
  }
  get videos() {
    return Array.from(this.videoByCamera.values());
  }
  get cameras() {
    return Array.from(this.videoByCamera.keys());
  }
  addVideo(video, camera) {
    if (!this.cameraGroup.cameras.includes(camera)) {
      this.cameraGroup.cameras.push(camera);
    }
    this.videoByCamera.set(camera, video);
    this.cameraByVideo.set(video, camera);
  }
  getCamera(video) {
    return this.cameraByVideo.get(video);
  }
  getVideo(camera) {
    return this.videoByCamera.get(camera);
  }
};
function injectSessionFrameResolver(labels) {
  const resolver = (i) => labels.frameAt(i);
  const install = (target) => {
    Object.defineProperty(target, "_frameResolver", {
      value: resolver,
      writable: true,
      enumerable: false,
      configurable: true
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
function cloneInstanceGroup(ig, remapCam, instanceMap) {
  let instanceByCamera;
  let instanceRefsByCamera;
  if (ig._instanceRefsByCamera) {
    instanceRefsByCamera = /* @__PURE__ */ new Map();
    for (const [c, pair] of ig._instanceRefsByCamera)
      instanceRefsByCamera.set(remapCam(c), [pair[0], pair[1]]);
  } else if (ig._instanceByCamera) {
    instanceByCamera = /* @__PURE__ */ new Map();
    for (const [c, inst] of ig._instanceByCamera)
      instanceByCamera.set(remapCam(c), instanceMap?.get(inst) ?? inst);
  }
  const points = ig.instance3d || !ig.points ? void 0 : ig.points.map((p) => [...p]);
  const copy = new InstanceGroup({
    instanceByCamera,
    instanceRefsByCamera,
    score: ig.score,
    points,
    identity: ig.identity,
    instance3d: ig.instance3d,
    metadata: structuredClone(ig.metadata)
  });
  copySourceMark(ig, copy);
  return copy;
}
function cloneRecordingSession(session, opts = {}) {
  const { videoMap, frameMap, instanceMap } = opts;
  const cameraMap = /* @__PURE__ */ new Map();
  const newCameras = session.cameraGroup.cameras.map((cam) => {
    const nc = new Camera({
      name: cam.name,
      rvec: [...cam.rvec],
      tvec: [...cam.tvec],
      matrix: cam.matrix?.map((r) => [...r]),
      distortions: cam.distortions ? [...cam.distortions] : void 0,
      size: cam.size ? [cam.size[0], cam.size[1]] : void 0
    });
    cameraMap.set(cam, nc);
    return nc;
  });
  const remapCam = (c) => cameraMap.get(c) ?? c;
  const cameraGroup = new CameraGroup({
    cameras: newCameras,
    metadata: structuredClone(session.cameraGroup.metadata)
  });
  const videoByCamera = /* @__PURE__ */ new Map();
  const cameraByVideo = /* @__PURE__ */ new Map();
  for (const [cam, vid] of session.videoByCamera) {
    const nc = remapCam(cam);
    const nv = videoMap?.get(vid) ?? vid;
    videoByCamera.set(nc, nv);
    cameraByVideo.set(nv, nc);
  }
  const frameGroupByFrameIdx = /* @__PURE__ */ new Map();
  for (const [fidx, fg] of session.frameGroupByFrameIdx) {
    const instanceGroups = fg.instanceGroups.map(
      (ig) => cloneInstanceGroup(ig, remapCam, instanceMap)
    );
    let labeledFrameByCamera;
    let labeledFrameRefsByCamera;
    if (fg._labeledFrameRefsByCamera) {
      labeledFrameRefsByCamera = /* @__PURE__ */ new Map();
      for (const [c, i] of fg._labeledFrameRefsByCamera)
        labeledFrameRefsByCamera.set(remapCam(c), i);
    } else if (fg._labeledFrameByCamera) {
      labeledFrameByCamera = /* @__PURE__ */ new Map();
      for (const [c, lf] of fg._labeledFrameByCamera)
        labeledFrameByCamera.set(remapCam(c), frameMap?.get(lf) ?? lf);
    }
    const copy = new FrameGroup({
      frameIdx: fg.frameIdx,
      instanceGroups,
      labeledFrameByCamera,
      labeledFrameRefsByCamera,
      metadata: structuredClone(fg.metadata)
    });
    copySourceMark(fg, copy);
    frameGroupByFrameIdx.set(fidx, copy);
  }
  return new RecordingSession({
    cameraGroup,
    frameGroupByFrameIdx,
    videoByCamera,
    cameraByVideo,
    metadata: structuredClone(session.metadata),
    rawJson: session.rawJson ? structuredClone(session.rawJson) : void 0
  });
}
function makeCameraFromDict(data) {
  return new Camera({
    name: data.name,
    rvec: data.rotation ?? [0, 0, 0],
    tvec: data.translation ?? [0, 0, 0],
    matrix: data.matrix,
    distortions: data.distortions,
    size: data.size
  });
}

// src/codecs/slp/format-check.ts
var SLP_FORMAT_ID_LIMIT = 4;
var SLP_SUPPORTED_FEATURES = /* @__PURE__ */ new Set();
var SlpFormatError = class extends Error {
  labelsPath;
  formatId;
  unsupportedFeatures;
  constructor(options) {
    super(options.message);
    this.name = "SlpFormatError";
    this.labelsPath = options.labelsPath;
    this.formatId = options.formatId;
    this.unsupportedFeatures = options.unsupportedFeatures ?? [];
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var SlpTableError = class extends SlpFormatError {
  constructor(labelsPath, detail, formatId) {
    const path = isUrl(labelsPath) ? redactUrl(labelsPath) : labelsPath;
    super({
      message: `The SLEAP labels file '${path}' ${detail}`,
      labelsPath: path,
      formatId
    });
    this.name = "SlpTableError";
  }
};
function attrValue(attr) {
  if (attr !== null && typeof attr === "object" && !Array.isArray(attr) && !ArrayBuffer.isView(attr) && "value" in attr) {
    return attr.value;
  }
  return attr;
}
function featureName(entry) {
  const text = entry instanceof Uint8Array ? new TextDecoder().decode(entry) : String(entry);
  return text.replace(/\u0000+$/, "").trim();
}
function requiredFeatures(attr) {
  const value = attrValue(attr);
  if (value === void 0 || value === null) return [];
  const entries = Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof Uint8Array) ? Array.from(value) : [value];
  return entries.map(featureName).filter((name) => name.length > 0);
}
function formatLabel(formatId) {
  return Number.isInteger(formatId) ? formatId.toFixed(1) : String(formatId);
}
function checkSlpFormat(source, metadataAttrs) {
  const attrs = metadataAttrs ?? {};
  const labelsPath = isUrl(source) ? redactUrl(source) : source;
  const rawFormatId = attrValue(attrs.format_id);
  const formatId = rawFormatId === void 0 || rawFormatId === null ? null : Number(rawFormatId);
  if (formatId !== null && formatId >= SLP_FORMAT_ID_LIMIT) {
    const readers = "It was written by a newer tool than this version of sleap-io.js knows. Open it with the tool that wrote it, or upgrade sleap-io.js.";
    throw new SlpFormatError({
      message: `The SLEAP labels file '${labelsPath}' is in SLP format ${formatLabel(formatId)}, which this version of sleap-io.js cannot read (it reads formats below ${formatLabel(SLP_FORMAT_ID_LIMIT)}). ` + readers,
      labelsPath,
      formatId
    });
  }
  const unsupported = [...new Set(requiredFeatures(attrs.required_features))].filter((name) => !SLP_SUPPORTED_FEATURES.has(name)).sort();
  if (unsupported.length > 0) {
    throw new SlpFormatError({
      message: `The SLEAP labels file '${labelsPath}'` + (formatId !== null && !Number.isNaN(formatId) ? ` (SLP format ${formatLabel(formatId)})` : "") + ` requires SLP features that this version of sleap-io.js does not support (${unsupported.join(", ")}). Open it with the tool that wrote it, such as a recent Python sleap-io, or upgrade sleap-io.js.`,
      labelsPath,
      formatId,
      unsupportedFeatures: unsupported
    });
  }
}

// src/codecs/slp/columnar.ts
var VIDEO_IS_INDEX = /* @__PURE__ */ Symbol.for(
  "sleap-io.slp.videoIsIndex"
);
var COLUMNAR_TABLE = /* @__PURE__ */ Symbol.for(
  "sleap-io.slp.columnarTable"
);
var REQUIRED_COLUMNS = {
  frames: ["video", "frame_idx", "instance_id_start", "instance_id_end"],
  instances: [
    "instance_type",
    "frame_id",
    "skeleton",
    "point_id_start",
    "point_id_end"
  ],
  points: ["x", "y"],
  pred_points: ["x", "y"]
};
var OPTIONAL_COLUMNS = {
  frames: { is_negative: 0 },
  instances: {
    track: -1,
    from_predicted: -1,
    score: Number.NaN,
    tracking_score: Number.NaN
  },
  points: { visible: 0, verified: 0, labeled: 1 },
  pred_points: { visible: 0, verified: 0, labeled: 1, score: Number.NaN }
};
var KNOWN_COLUMNS = {
  frames: [
    ...REQUIRED_COLUMNS.frames,
    ...Object.keys(OPTIONAL_COLUMNS.frames),
    "frame_id"
  ],
  instances: [
    ...REQUIRED_COLUMNS.instances,
    ...Object.keys(OPTIONAL_COLUMNS.instances),
    "instance_id"
  ],
  points: [...REQUIRED_COLUMNS.points, ...Object.keys(OPTIONAL_COLUMNS.points)],
  pred_points: [
    ...REQUIRED_COLUMNS.pred_points,
    ...Object.keys(OPTIONAL_COLUMNS.pred_points)
  ]
};
var METADATA_SUBGROUP = "metadata";
function isKnownPoseColumn(table, name) {
  return KNOWN_COLUMNS[table].includes(name);
}
var KNOWN_BBOX_COLUMNS = [
  "x1",
  "y1",
  "x2",
  "y2",
  "angle",
  "video",
  "frame_idx",
  "track",
  "instance",
  "is_predicted",
  "score",
  "tracking_score",
  "category",
  "name",
  "source"
];
function unknownColumns(table, children) {
  const known = table === "bboxes" ? KNOWN_BBOX_COLUMNS : KNOWN_COLUMNS[table];
  return children.filter((name) => name !== METADATA_SUBGROUP && !known.includes(name)).map((name) => `${table}/${name}`);
}
function numberColumn(values) {
  if (!values) return new Float64Array(0);
  if (values instanceof Float64Array) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = Number(values[i]);
  return out;
}
function poseTableFromColumns(table, columns, labelsPath) {
  const present = Object.keys(columns).filter((k) => columns[k] !== void 0);
  const missing = REQUIRED_COLUMNS[table].filter((c) => !present.includes(c));
  if (missing.length > 0) {
    throw new SlpTableError(
      labelsPath,
      `has a /${table} table without the required column(s) ${missing.join(", ")}.`,
      3
    );
  }
  const out = {};
  let rows = -1;
  let first = "";
  for (const name of present) {
    const values = numberColumn(columns[name]);
    if (rows === -1) {
      rows = values.length;
      first = name;
    }
    if (values.length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table} columns of different lengths (${first}: ${rows} values, ${name}: ${values.length}).`,
        3
      );
    }
    out[name] = values;
  }
  rows = Math.max(rows, 0);
  const rowIds = () => Float64Array.from({ length: rows }, (_, i) => i);
  for (const [name, value] of Object.entries(OPTIONAL_COLUMNS[table])) {
    out[name] ??= new Float64Array(rows).fill(value);
  }
  const marks2 = out;
  marks2[COLUMNAR_TABLE] = true;
  if (table === "frames") {
    out.frame_id = rowIds();
    marks2[VIDEO_IS_INDEX] = true;
  } else if (table === "instances") {
    out.instance_id = rowIds();
  } else {
    out.complete = out.verified;
    const labeled = out.labeled;
    const visible = out.visible;
    for (let i = 0; i < rows; i += 1) {
      if (visible[i]) labeled[i] = 1;
    }
  }
  return out;
}
function isColumnarTable(table) {
  return !!table && !!table[COLUMNAR_TABLE];
}
function skipsInstanceRow(instances, row) {
  if (!isColumnarTable(instances)) return false;
  const type = Number(instances.instance_type?.[row]);
  return type !== 0 && type !== 1;
}
function hasSkippedInstanceRows(instances) {
  if (!isColumnarTable(instances)) return false;
  const types = instances.instance_type ?? [];
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] !== 0 && types[i] !== 1) return true;
  }
  return false;
}
function countUnlabeledPoints(points) {
  const labeled = points?.labeled;
  if (!labeled) return 0;
  const visible = points?.visible ?? [];
  let count = 0;
  for (let i = 0; i < labeled.length; i += 1) {
    if (!Number(labeled[i]) && !Number(visible[i])) count += 1;
  }
  return count;
}
function checkPoseTables(options) {
  const { frames, instances, nPoints, nPredPoints, nVideos } = options;
  const col2 = (t, name) => t[name] ?? [];
  const start = col2(frames, "instance_id_start");
  const end = col2(frames, "instance_id_end");
  const video = col2(frames, "video");
  const nFrames = start.length;
  const nInstances = col2(instances, "instance_type").length;
  const problems = [];
  let rangesOk = true;
  for (let i = 0; i < nFrames; i += 1) {
    if (end[i] < start[i] || start[i] < 0 || i > 0 && start[i] < end[i - 1]) {
      rangesOk = false;
      break;
    }
  }
  if (!rangesOk) problems.push("/frames instance ranges decrease or overlap");
  const last = nFrames > 0 ? Number(end[nFrames - 1]) : 0;
  if (last !== nInstances) {
    problems.push(
      `/frames instance ranges end at ${last}, not at the instance count (${nInstances})`
    );
  }
  if (rangesOk) {
    const owner = new Float64Array(nInstances).fill(-1);
    for (let f = 0; f < nFrames; f += 1) {
      for (let i = start[f]; i < end[f] && i < nInstances; i += 1) {
        owner[i] = f;
      }
    }
    const frameId = col2(instances, "frame_id");
    for (let i = 0; i < nInstances; i += 1) {
      if (Number(frameId[i]) !== owner[i]) {
        problems.push("/instances frame_id disagrees with the /frames ranges");
        break;
      }
    }
  }
  const type = col2(instances, "instance_type");
  const pStart = col2(instances, "point_id_start");
  const pEnd = col2(instances, "point_id_end");
  for (const [instanceType, n, table] of [
    [0, nPoints, "points"],
    [1, nPredPoints, "pred_points"]
  ]) {
    if (n === null) continue;
    for (let i = 0; i < nInstances; i += 1) {
      if (Number(type[i]) !== instanceType) continue;
      if (pStart[i] < 0 || pEnd[i] < pStart[i] || pEnd[i] > n) {
        problems.push(
          `/instances point ranges fall outside /${table} (${n} rows)`
        );
        break;
      }
    }
  }
  const fromPredicted = col2(instances, "from_predicted");
  for (let i = 0; i < fromPredicted.length; i += 1) {
    if (fromPredicted[i] < -1 || fromPredicted[i] >= nInstances) {
      problems.push("/instances from_predicted is not an instance row");
      break;
    }
  }
  for (let i = 0; i < video.length; i += 1) {
    if (video[i] < 0 || video[i] >= nVideos) {
      problems.push(`/frames video is not one of the ${nVideos} videos`);
      break;
    }
  }
  if (problems.length > 0) {
    throw new SlpTableError(
      options.labelsPath,
      `has inconsistent pose tables: ${problems.join("; ")}.`,
      3
    );
  }
}
function negativeFrameKeysFromFrames(frames) {
  const keys = /* @__PURE__ */ new Set();
  const flags = frames.is_negative ?? [];
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i]) keys.add(`${frames.video[i]}:${frames.frame_idx[i]}`);
  }
  return keys;
}

// src/codecs/slp/columnar-tables.ts
var FORMAT3_TABLES = [
  "rois",
  "masks",
  "masks/score_maps",
  "label_images",
  "label_images/objects",
  "label_images/score_maps",
  "identity/links",
  "categories/links",
  "session_data/frame_groups",
  "session_data/instance_groups",
  "session_data/instance_group_members"
];
var SPATIAL = ["scale_x", "scale_y", "offset_x", "offset_y"];
var SPATIAL_DEFAULTS = { scale_x: 1, scale_y: 1, offset_x: 0, offset_y: 0 };
var SCORE_MAP_COLUMNS = [
  "data_start",
  "data_end",
  "height",
  "width",
  ...SPATIAL
];
var TABLE_SPECS = {
  rois: {
    numbers: [
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "instance",
      "is_predicted",
      "score",
      "tracking_score",
      "wkb_start",
      "wkb_end"
    ],
    strings: ["name", "category", "source"],
    defaults: {
      annotation_type: 0,
      instance: -1,
      is_predicted: 0,
      score: Number.NaN,
      tracking_score: Number.NaN,
      name: "",
      category: "",
      source: ""
    },
    buffer: "wkb"
  },
  masks: {
    numbers: [
      "height",
      "width",
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "instance",
      "from_predicted",
      "is_predicted",
      "score",
      "tracking_score",
      "rle_start",
      "rle_end",
      ...SPATIAL
    ],
    strings: ["name", "category", "source"],
    defaults: {
      annotation_type: 2,
      instance: -1,
      from_predicted: -1,
      is_predicted: 0,
      score: Number.NaN,
      tracking_score: Number.NaN,
      ...SPATIAL_DEFAULTS,
      name: "",
      category: "",
      source: ""
    },
    buffer: "rle"
  },
  "masks/score_maps": {
    numbers: ["mask_idx", ...SCORE_MAP_COLUMNS],
    strings: [],
    defaults: SPATIAL_DEFAULTS,
    buffer: "data"
  },
  label_images: {
    numbers: [
      "video",
      "frame_idx",
      "height",
      "width",
      "n_objects",
      "objects_start",
      "data_start",
      "data_end",
      "is_predicted",
      "score",
      ...SPATIAL
    ],
    strings: ["source"],
    defaults: {
      is_predicted: 0,
      score: Number.NaN,
      ...SPATIAL_DEFAULTS,
      source: ""
    },
    buffer: "data"
  },
  "label_images/objects": {
    numbers: ["label_id", "track", "instance", "score", "tracking_score"],
    strings: ["name", "category"],
    defaults: {
      score: Number.NaN,
      tracking_score: Number.NaN,
      name: "",
      category: ""
    }
  },
  "label_images/score_maps": {
    numbers: ["li_idx", ...SCORE_MAP_COLUMNS],
    strings: [],
    defaults: SPATIAL_DEFAULTS,
    buffer: "data"
  },
  "identity/links": {
    numbers: ["owner_type", "owner_id", "identity_idx", "identity_score"],
    strings: [],
    defaults: {}
  },
  "categories/links": {
    numbers: ["owner_type", "owner_id", "category_idx", "category_score"],
    strings: [],
    defaults: {}
  },
  "session_data/frame_groups": {
    numbers: ["frame_idx", "ig_start", "ig_end"],
    strings: [],
    defaults: {}
  },
  "session_data/instance_groups": {
    numbers: [
      "identity_idx",
      "score",
      "instance_3d_score",
      "pts3d_start",
      "pts3d_end",
      "pts3d_predicted",
      "member_start",
      "member_end"
    ],
    strings: [],
    defaults: {}
  },
  "session_data/instance_group_members": {
    numbers: ["camera", "lf", "inst"],
    strings: [],
    defaults: {}
  }
};
function isKnownTableColumn(table, name) {
  const spec = TABLE_SPECS[table];
  return spec.numbers.includes(name) || spec.strings.includes(name);
}
function unknownTableColumns(table, datasets) {
  const buffer = TABLE_SPECS[table].buffer;
  return datasets.filter((name) => name !== buffer && !isKnownTableColumn(table, name)).map((name) => `${table}/${name}`);
}
var KNOWN_SUBTABLES = {
  masks: ["score_maps"],
  label_images: ["objects", "score_maps"]
};
function unknownTableGroups(table, groups) {
  const known = KNOWN_SUBTABLES[table] ?? [];
  return groups.filter((name) => !known.includes(name)).map((name) => `${table}/${name}`);
}
function decodeString(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return value === null || value === void 0 ? "" : String(value);
}
function tableFromColumns(table, columns, labelsPath, unknownLengths = {}) {
  const spec = TABLE_SPECS[table];
  const present = Object.keys(columns).filter((k) => columns[k] !== void 0);
  const missing = [...spec.numbers, ...spec.strings].filter(
    (c) => !(c in spec.defaults) && !present.includes(c)
  );
  if (missing.length > 0) {
    throw new SlpTableError(
      labelsPath,
      `has a /${table} table without the required column(s) ${missing.join(", ")}.`,
      3
    );
  }
  const out = {};
  let rows = -1;
  let first = "";
  for (const name of present) {
    const raw = columns[name];
    const values = spec.strings.includes(name) ? Array.from(raw, decodeString) : numberColumn(raw);
    if (rows === -1) {
      rows = values.length;
      first = name;
    }
    if (values.length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table} columns of different lengths (${first}: ${rows} values, ${name}: ${values.length}).`,
        3
      );
    }
    out[name] = values;
  }
  for (const [name, length] of Object.entries(unknownLengths)) {
    if (rows !== -1 && length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table} columns of different lengths (${first}: ${rows} values, ${name}: ${length}).`,
        3
      );
    }
  }
  rows = Math.max(rows, 0);
  for (const [name, value] of Object.entries(spec.defaults)) {
    if (out[name] !== void 0) continue;
    out[name] = typeof value === "string" ? new Array(rows).fill(value) : new Float64Array(rows).fill(value);
  }
  out[COLUMNAR_TABLE] = true;
  return out;
}
function tableRows(table) {
  if (!table) return 0;
  for (const column of Object.values(table)) {
    if (column && typeof column.length === "number") return column.length;
  }
  return 0;
}
var col = (table, name) => table[name] ?? [];
function spanOutOfRange(start, end, n) {
  for (let i = 0; i < start.length; i += 1) {
    if (start[i] < 0 || end[i] < start[i] || end[i] > n) return true;
  }
  return false;
}
function indexOutOfRange(values, n, optional = true) {
  const lowest = optional ? -1 : 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] < lowest || values[i] >= n) return true;
  }
  return false;
}
function annotationProblems(table, rows, counts, withVideo) {
  const problems = [];
  const targets = [
    ["track", counts.nTracks, "tracks"],
    ["instance", counts.nInstances, "instances"]
  ];
  if (withVideo) targets.unshift(["video", counts.nVideos, "videos"]);
  for (const [column, n, what] of targets) {
    if (indexOutOfRange(col(rows, column), n)) {
      problems.push(`/${table} ${column} is not one of the ${n} ${what}`);
    }
  }
  return problems;
}
function reportTableProblems(labelsPath, problems) {
  if (problems.length === 0) return;
  throw new SlpTableError(
    labelsPath,
    `has inconsistent tables: ${problems.join("; ")}.`,
    3
  );
}
function roiProblems(rows, nBytes, counts) {
  const problems = annotationProblems("rois", rows, counts, true);
  if (spanOutOfRange(col(rows, "wkb_start"), col(rows, "wkb_end"), nBytes)) {
    problems.push(`/rois wkb ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}
function maskProblems(rows, nBytes, counts) {
  const problems = annotationProblems("masks", rows, counts, true);
  if (indexOutOfRange(col(rows, "from_predicted"), tableRows(rows))) {
    problems.push("/masks from_predicted is not a mask row");
  }
  if (spanOutOfRange(col(rows, "rle_start"), col(rows, "rle_end"), nBytes)) {
    problems.push(`/masks rle ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}
function scoreMapProblems(table, rows, nOwners, nBytes) {
  const index = table === "masks/score_maps" ? "mask_idx" : "li_idx";
  const owner = table === "masks/score_maps" ? "masks" : "label_images";
  const problems = [];
  if (indexOutOfRange(col(rows, index), nOwners, false)) {
    problems.push(`/${table} ${index} is not one of the ${nOwners} /${owner}`);
  }
  if (spanOutOfRange(col(rows, "data_start"), col(rows, "data_end"), nBytes)) {
    problems.push(`/${table} ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}
function labelImageProblems(rows, objects, data, counts) {
  const problems = [];
  if (indexOutOfRange(col(rows, "video"), counts.nVideos)) {
    problems.push(
      `/label_images video is not one of the ${counts.nVideos} videos`
    );
  }
  const start = col(rows, "objects_start");
  const count = col(rows, "n_objects");
  const nObjects = tableRows(objects);
  for (let i = 0; i < start.length; i += 1) {
    const end = start[i] + count[i];
    if (start[i] < 0 || end < start[i] || end > nObjects) {
      problems.push(
        `/label_images object ranges fall outside /label_images/objects (${nObjects} rows)`
      );
      break;
    }
  }
  const n = tableRows(rows);
  if (data === null) {
    problems.push("/label_images has no pixel data");
  } else if (data.length === 3) {
    if (data[0] < n) {
      problems.push(
        `/label_images has ${n} rows but ${data[0]} frames of data`
      );
    }
  } else if (spanOutOfRange(col(rows, "data_start"), col(rows, "data_end"), data[0] ?? 0)) {
    problems.push(
      `/label_images data ranges fall outside the buffer (${data[0] ?? 0})`
    );
  }
  return [
    ...problems,
    ...annotationProblems("label_images/objects", objects, counts, false)
  ];
}
function linkProblems(table, rows, nCatalog) {
  const index = table === "identity/links" ? "identity_idx" : "category_idx";
  if (nCatalog === null || !indexOutOfRange(col(rows, index), nCatalog, false)) {
    return [];
  }
  return [`/${table} ${index} is not one of the ${nCatalog} catalog entries`];
}
function sessionProblems(options) {
  const { frameGroups, instanceGroups: groups, members } = options;
  const problems = [];
  const nGroups = tableRows(groups);
  const nMembers = tableRows(members);
  if (spanOutOfRange(
    col(frameGroups, "ig_start"),
    col(frameGroups, "ig_end"),
    nGroups
  )) {
    problems.push(
      `/session_data/frame_groups ranges fall outside instance_groups (${nGroups} rows)`
    );
  }
  if (spanOutOfRange(
    col(groups, "member_start"),
    col(groups, "member_end"),
    nMembers
  )) {
    problems.push(
      `/session_data/instance_groups ranges fall outside instance_group_members (${nMembers} rows)`
    );
  }
  const start = col(groups, "pts3d_start");
  const end = col(groups, "pts3d_end");
  const predicted = col(groups, "pts3d_predicted");
  for (const [isPredicted, name, n] of [
    [false, "points_3d", options.nPoints3d],
    [true, "pred_points_3d", options.nPredPoints3d]
  ]) {
    for (let i = 0; i < start.length; i += 1) {
      if (start[i] < 0 || !!predicted[i] !== isPredicted) continue;
      if (end[i] < start[i] || end[i] > n) {
        problems.push(
          `/session_data/instance_groups 3D ranges fall outside ${name} (${n} rows)`
        );
        break;
      }
    }
  }
  if (indexOutOfRange(col(groups, "identity_idx"), options.nIdentities)) {
    problems.push(
      `/session_data/instance_groups identity_idx is not one of the ${options.nIdentities} identities`
    );
  }
  if (options.nFrames !== null && indexOutOfRange(col(members, "lf"), options.nFrames, false)) {
    problems.push(
      `/session_data/instance_group_members lf is not one of the ${options.nFrames} frames`
    );
  }
  const camera = col(members, "camera");
  const inst = col(members, "inst");
  for (let i = 0; i < camera.length; i += 1) {
    if (camera[i] < 0 || inst[i] < 0) {
      problems.push(
        "/session_data/instance_group_members has negative indices"
      );
      break;
    }
  }
  return problems;
}

// src/codecs/slp/column-carry.ts
var ColumnCarry = class {
  tables;
  constructor(tables) {
    this.tables = new Map(tables ?? []);
  }
  /** Whether any table has columns to carry. */
  get size() {
    return this.tables.size;
  }
  /** The table names, as paths like `/points`. */
  tablePaths() {
    return [...this.tables.keys()].map((name) => `/${name}`);
  }
};
function permuteColumns(columns, order) {
  const out = {};
  for (const [name, column] of Object.entries(columns)) {
    const values = column.values;
    const width = (column.shape ?? [0]).slice(1).reduce((a, b) => a * b, 1);
    const picked = order.flatMap(
      (row) => Array.from({ length: width }, (_, k) => values[row * width + k])
    );
    out[name] = {
      ...column.shape ? { shape: column.shape } : {},
      dtype: column.dtype,
      values: column.dtype === "S" ? picked : typeof picked[0] === "bigint" ? BigInt64Array.from(picked) : Float64Array.from(picked)
    };
  }
  return out;
}
function sameOwner(a, b) {
  return a === b || typeof a === "number" && typeof b === "number" && a === b;
}
function sameKey(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!sameOwner(a[i], b[i])) return false;
  }
  return true;
}
function columnList(table) {
  return Object.keys(table.columns).join(", ");
}
var CarrySession = class {
  carry;
  consumed = /* @__PURE__ */ new Set();
  constructor(carry) {
    this.carry = carry && carry.size > 0 ? carry : null;
  }
  /**
   * The carried columns of `table` when `keys` (one per row being written,
   * in order) are the owners the columns were read with; otherwise none, with
   * a warning when there were columns to write.
   */
  columnsFor(table, keys) {
    const carried = this.carry?.tables.get(table);
    if (!carried) return {};
    this.consumed.add(table);
    const owners = carried.owners;
    if (owners !== null && owners.length === keys.length && owners.every((owner, i) => sameKey(owner, keys[i]))) {
      return { ...carried.columns };
    }
    const byValue = owners !== null && table.endsWith("/links");
    if (byValue && owners.length === keys.length) {
      const rowOf = /* @__PURE__ */ new Map();
      owners.forEach((owner, i) => {
        rowOf.set(JSON.stringify(owner), i);
      });
      const order = keys.map((key) => rowOf.get(JSON.stringify(key)));
      if (rowOf.size === owners.length && order.every((row) => row !== void 0)) {
        return permuteColumns(carried.columns, order);
      }
    }
    warnDropped(table, carried, "changed");
    return {};
  }
  /**
   * Warn about carried columns of tables the save wrote no rows for (every
   * record of the table is gone, so its unknown columns are dropped).
   */
  finish() {
    if (!this.carry) return;
    for (const [table, carried] of this.carry.tables) {
      if (!this.consumed.has(table)) warnDropped(table, carried, "changed");
    }
  }
};
function warnDropped(table, carried, reason) {
  const why = reason === "legacy" ? "the SLP 2.x layout cannot store them" : "its records changed since the file was loaded, so its rows no longer line up";
  console.warn(
    `Unknown column(s) ${columnList(carried)} of /${table} were not saved: ${why}.`
  );
}
function warnDroppedCarry(carry) {
  if (!carry) return;
  for (const [table, carried] of carry.tables) {
    warnDropped(table, carried, "legacy");
  }
}

// src/codecs/slp/carry-read.ts
var POSE_TABLES = [
  "frames",
  "instances",
  "points",
  "pred_points"
];
var CARRIED_TABLES = [
  ...POSE_TABLES,
  "bboxes",
  ...FORMAT3_TABLES
];
var METADATA_TABLES = [
  "instances",
  "frames",
  "bboxes"
];
function isUnknownColumn(table, name) {
  if (name === METADATA_SUBGROUP) return false;
  if (POSE_TABLES.includes(table)) {
    return !isKnownPoseColumn(table, name);
  }
  if (table === "bboxes") return !KNOWN_BBOX_COLUMNS.includes(name);
  const spec = TABLE_SPECS[table];
  if (!spec) return false;
  return name !== spec.buffer && !isKnownTableColumn(table, name);
}
function carriedDtype(info) {
  if (!info || !Array.isArray(info.shape) || info.shape.length < 1) {
    return null;
  }
  const size = info.size ?? 8;
  switch (info.type) {
    case 0: {
      const chars = { 1: "b", 2: "h", 4: "i", 8: "q" };
      const c = chars[size];
      return c ? `<${info.signed === false ? c.toUpperCase() : c}` : null;
    }
    case 1:
      return size === 4 ? "<f" : size === 8 ? "<d" : null;
    case 3:
      return info.shape.length === 1 ? "S" : null;
    case 8:
      return size === 1 ? "<B" : null;
    default:
      return null;
  }
}
function isCarriable(info) {
  return carriedDtype(info) !== null;
}
function carriedColumn(info, values) {
  const dtype = carriedDtype(info);
  if (dtype === null || values === null || values === void 0) return null;
  const shape = info?.shape ?? [];
  if (dtype === "S") {
    const list = Array.from(
      values,
      (v) => v instanceof Uint8Array ? new TextDecoder().decode(v).replace(/\0+$/, "") : String(v ?? "")
    );
    return { values: list, dtype };
  }
  if (typeof values !== "object" || !("length" in values)) {
    return null;
  }
  return {
    values,
    dtype,
    ...shape.length > 1 ? { shape: [...shape] } : {}
  };
}
function unreadTableMembers(table, members) {
  const own = POSE_TABLES.includes(table) || table === "bboxes";
  const out = [];
  for (const m of members) {
    if (m.group) {
      if (own && m.name !== METADATA_SUBGROUP) out.push(`${table}/${m.name}`);
    } else if (isUnknownColumn(table, m.name) && !isCarriable(m.info)) {
      out.push(`${table}/${m.name}`);
    }
  }
  return out;
}
function unreadMetadataMembers(table, members, read) {
  return members.filter((key) => !read.includes(key)).map((key) => `${table}/${METADATA_SUBGROUP}/${key}`);
}
function keysOf(owners) {
  if (owners.some((o) => o === void 0)) return null;
  return owners.map((o) => [o]);
}
function pointOwnerKeys(spans, rows) {
  spans.sort((a, b) => a[0] - b[0]);
  let position = 0;
  for (const [start, end, owner] of spans) {
    if (start !== position || owner === void 0) return null;
    position = end;
  }
  return position === rows ? spans.map(([, , owner, points]) => [owner, points]) : null;
}
function sessionCarryOwners(sessions, table) {
  const frameGroups = [];
  const instanceGroups = [];
  for (const session of sessions) {
    for (const fg of session.frameGroups.values()) {
      if (fg.instanceGroups.length === 0) continue;
      frameGroups.push(fg);
      for (const ig of fg.instanceGroups) {
        instanceGroups.push([ig, session.cameraGroup.cameras]);
      }
    }
  }
  if (frameGroups.length !== table.nFrameGroups || instanceGroups.length !== table.memberStart.length) {
    return void 0;
  }
  const members = [];
  instanceGroups.forEach(([ig, cameras], k) => {
    for (let r = Number(table.memberStart[k]); r < Number(table.memberEnd[k]); r++) {
      members.push([ig, cameras[Number(table.camera[r])]]);
    }
  });
  return {
    frameGroups,
    instanceGroups: instanceGroups.map(([ig]) => ig),
    members
  };
}
function buildColumnCarry(unknown, owners, tables = CARRIED_TABLES) {
  const entries = [];
  for (const table of tables) {
    const columns = unknown[table];
    if (!columns || Object.keys(columns).length === 0) continue;
    entries.push([table, { owners: ownerKeys(table, owners), columns }]);
  }
  return entries.length > 0 ? new ColumnCarry(entries) : null;
}
function ownerKeys(table, o) {
  switch (table) {
    case "frames":
      return o.frames ? keysOf(o.frames) : null;
    case "instances":
      return o.instances ? keysOf(o.instances) : null;
    case "points":
    case "pred_points": {
      if (!o.instances || !o.instanceRows) return null;
      const want = table === "points" ? 0 : 1;
      const spans = [];
      const { type, start, end } = o.instanceRows;
      for (let i = 0; i < type.length; i++) {
        if (Number(type[i]) !== want) continue;
        const owner = o.instances[i];
        spans.push([
          Number(start[i]),
          Number(end[i]),
          owner,
          owner && o.pointsOf ? o.pointsOf(owner) : void 0
        ]);
      }
      return pointOwnerKeys(
        spans,
        (table === "points" ? o.nPoints : o.nPredPoints) ?? 0
      );
    }
    case "rois":
      return o.rois ? keysOf(o.rois) : null;
    case "bboxes":
      return o.bboxes ? keysOf(o.bboxes) : null;
    case "masks":
      return o.masks ? keysOf(o.masks) : null;
    case "masks/score_maps":
      return o.masks && o.maskScoreMapOwners ? keysOf(Array.from(o.maskScoreMapOwners, (i) => o.masks?.[Number(i)])) : null;
    case "label_images":
      return o.labelImages ? keysOf(o.labelImages) : null;
    case "label_images/objects":
      return o.labelImageObjects ? keysOf(o.labelImageObjects) : null;
    case "label_images/score_maps":
      return o.labelImages && o.labelImageScoreMapOwners ? keysOf(
        Array.from(
          o.labelImageScoreMapOwners,
          (i) => o.labelImages?.[Number(i)]
        )
      ) : null;
    case "identity/links":
      return o.identityLinks ? o.identityLinks.map((k) => [...k]) : null;
    case "categories/links":
      return o.categoryLinks ? o.categoryLinks.map((k) => [...k]) : null;
    case "session_data/frame_groups":
      return o.sessions ? keysOf(o.sessions.frameGroups) : null;
    case "session_data/instance_groups":
      return o.sessions ? keysOf(o.sessions.instanceGroups) : null;
    case "session_data/instance_group_members":
      return o.sessions?.members.every((k) => k[1] !== void 0) ? o.sessions.members.map((k) => [...k]) : null;
    default:
      return null;
  }
}

// src/model/instance3d.ts
var Instance3D = class {
  points;
  skeleton;
  score;
  metadata;
  constructor(options) {
    this.points = options.points;
    this.skeleton = options.skeleton;
    this.score = options.score;
    this.metadata = options?.metadata ?? {};
  }
  get nVisible() {
    if (!this.points) return 0;
    return this.points.filter((p) => !p.some(Number.isNaN)).length;
  }
  get isEmpty() {
    return this.nVisible === 0;
  }
};
var PredictedInstance3D = class extends Instance3D {
  pointScores;
  constructor(options) {
    super(options);
    this.pointScores = options.pointScores;
  }
};

// src/model/record-metadata.ts
function metadataValue(kind, raw) {
  switch (kind) {
    case "bool":
      return Boolean(Number(raw));
    case "int":
    case "float":
      return Number(raw);
    default:
      return raw instanceof Uint8Array ? new TextDecoder().decode(raw).replace(/\0+$/, "") : String(raw ?? "");
  }
}
function metadataRecord(columns, row) {
  const out = {};
  if (!columns) return out;
  for (const key of Object.keys(columns)) {
    const { kind, values, present } = columns[key];
    if (present && !Number(present[row])) continue;
    out[key] = metadataValue(kind, values[row]);
  }
  return out;
}
function metadataKeys(columns) {
  return columns ? Object.keys(columns).sort() : [];
}
function metadataKeysOf(records) {
  const keys = /* @__PURE__ */ new Set();
  for (const record of records) {
    for (const key of Object.keys(record.metadata ?? {})) keys.add(key);
  }
  return [...keys].sort();
}

// src/codecs/slp/format3.ts
var LOSSLESS_FORMAT3_ASKS = true;
function formatLabel2(formatId) {
  return Number.isInteger(formatId) ? formatId.toFixed(1) : String(formatId);
}
function safePath(source) {
  return isUrl(source) ? redactUrl(source) : source;
}
function describeDrops(summary) {
  const drops = [];
  if (summary.unlabeledPoints > 0) {
    drops.push(
      `${summary.unlabeledPoints} unlabelled point(s) (saved as hidden points with no location)`
    );
  }
  for (const table of ["instances", "frames", "bboxes"]) {
    const keys = summary.metadataKeys[table];
    if (keys.length > 0) {
      const what = table === "bboxes" ? "bounding box" : table.slice(0, -1);
      drops.push(`${what} metadata (${keys.join(", ")})`);
    }
  }
  if (summary.unknownColumns.length > 0) {
    drops.push(`unknown columns (${summary.unknownColumns.join(", ")})`);
  }
  if (summary.unreadTables.length > 0) {
    drops.push(
      `what this version does not read (${summary.unreadTables.join(", ")})`
    );
  }
  return drops;
}
var SlpFormat3ChoiceError = class extends SlpFormatError {
  summary;
  constructor(labelsPath, summary) {
    const path = safePath(labelsPath);
    const drops = describeDrops(summary);
    const unread = summary.unreadTables;
    super({
      message: `The SLEAP labels file '${path}' is in SLP format ${formatLabel2(summary.formatId)}, which SLEAP and sleap-io < 0.10 cannot open.` + (unread.length > 0 ? ` It holds what this version does not read (${unread.join(", ")}), which a save in either layout would drop, so it is not opened without the format3 option.` : "") + " Saving it in the 2.x layout would " + (drops.length > 0 ? `drop ${drops.join("; ")}.` : "drop nothing.") + ` Open it with the option format3: "keep" to save it in format ${formatLabel2(summary.formatId)}, format3: "view" to load it read-only, or format3: "edit" to save it in the 2.x layout.`,
      labelsPath: path,
      formatId: summary.formatId
    });
    this.name = "SlpFormat3ChoiceError";
    this.summary = summary;
  }
};
var SlpViewOnlyError = class extends Error {
  sourceFormat;
  constructor(sourceFormat) {
    super(
      `These labels were loaded from '${sourceFormat.labelsPath}' (SLP format ${formatLabel2(sourceFormat.formatId)}) for viewing only (format3: "view"), so they cannot be saved. Load the file without format3 (or with format3: "keep") to save it in format ${formatLabel2(sourceFormat.formatId)}, or with format3: "edit" to save it in the 2.x layout` + (() => {
        const drops = describeDrops(sourceFormat.summary);
        return drops.length > 0 ? `, which drops ${drops.join("; ")}` : "";
      })() + "."
    );
    this.name = "SlpViewOnlyError";
    this.sourceFormat = sourceFormat;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
function freezeSummary(summary) {
  return Object.freeze({
    ...summary,
    metadataKeys: Object.freeze({
      instances: Object.freeze([...summary.metadataKeys.instances]),
      frames: Object.freeze([...summary.metadataKeys.frames]),
      bboxes: Object.freeze([...summary.metadataKeys.bboxes])
    }),
    unknownColumns: Object.freeze([
      ...summary.unknownColumns
    ]),
    unreadTables: Object.freeze([
      ...summary.unreadTables
    ])
  });
}
var READ_TOP_LEVEL = /* @__PURE__ */ new Set([
  "metadata",
  "videos_json",
  "tracks_json",
  "suggestions_json",
  "sessions_json",
  "session_data",
  "identity",
  "identities_json",
  "embeddings",
  "categories",
  "frames",
  "instances",
  "points",
  "pred_points",
  "negative_frames",
  "video_crops",
  "bboxes",
  "centroids",
  "rois",
  "roi_wkb",
  "roi_categories",
  "roi_names",
  "roi_sources",
  "masks",
  "mask_rle",
  "mask_categories",
  "mask_names",
  "mask_sources",
  "mask_score_map_index",
  "mask_score_maps",
  "label_images",
  "label_image_objects",
  "label_image_data",
  "label_image_sources",
  "label_image_obj_categories",
  "label_image_obj_names",
  "label_image_score_map_index",
  "label_image_score_maps",
  "preview"
]);
var READ_GROUP_MEMBERS = {
  identity: /* @__PURE__ */ new Set(["name", "meta_owner", "meta_key", "meta_val", "links"]),
  categories: /* @__PURE__ */ new Set(["name", "links"]),
  embeddings: /* @__PURE__ */ new Set([
    "vectors",
    "owner_type",
    "owner_id",
    "category_vectors",
    "category_owner_type",
    "category_owner_id"
  ]),
  session_data: /* @__PURE__ */ new Set([
    "frame_groups",
    "instance_groups",
    "instance_group_members",
    "points_3d",
    "pred_points_3d",
    "frame_group_meta",
    "instance_group_meta"
  ])
};
var PARTLY_READ_GROUPS = Object.keys(READ_GROUP_MEMBERS);
function unreadMembers(options) {
  const out = [];
  for (const name of options.root) {
    if (READ_TOP_LEVEL.has(name) || /^video\d+$/.test(name)) continue;
    if (name === "provenance_json" && options.provenanceInMetadata) continue;
    out.push(name);
  }
  for (const [group, members] of Object.entries(options.groups)) {
    const read = READ_GROUP_MEMBERS[group];
    if (!read) continue;
    for (const name of members) {
      if (!read.has(name)) out.push(`${group}/${name}`);
    }
  }
  return out.sort();
}
function buildFormat3Summary(options) {
  const unlabeledPoints = options.unlabeledUserPoints + options.unlabeledPredictedPoints;
  const { instances, frames, bboxes } = options.metadataKeys;
  return {
    formatId: options.formatId,
    unlabeledPoints,
    unlabeledUserPoints: options.unlabeledUserPoints,
    unlabeledPredictedPoints: options.unlabeledPredictedPoints,
    metadataKeys: {
      instances: [...instances].sort(),
      frames: [...frames].sort(),
      bboxes: [...bboxes].sort()
    },
    unknownColumns: [...options.unknownColumns].sort(),
    unreadTables: [...options.unreadTables ?? []].sort(),
    lossless: unlabeledPoints === 0 && instances.length + frames.length + bboxes.length === 0 && options.unknownColumns.length === 0 && (options.unreadTables ?? []).length === 0
  };
}
function chooseFormat3Access(labelsPath, summary, choice, metadataKinds) {
  checkFormat3Option(choice);
  let access;
  if (choice === void 0 && summary.unreadTables.length > 0) {
    throw new SlpFormat3ChoiceError(labelsPath, summary);
  }
  if (choice === "ask") {
    if (!(summary.lossless && !LOSSLESS_FORMAT3_ASKS)) {
      throw new SlpFormat3ChoiceError(labelsPath, summary);
    }
    access = "keep";
  } else {
    access = choice ?? "keep";
  }
  const kinds = metadataKinds && Object.keys(metadataKinds.instances).length + Object.keys(metadataKinds.frames).length + Object.keys(metadataKinds.bboxes).length > 0 ? Object.freeze({
    instances: Object.freeze({ ...metadataKinds.instances }),
    frames: Object.freeze({ ...metadataKinds.frames }),
    bboxes: Object.freeze({ ...metadataKinds.bboxes })
  }) : void 0;
  return Object.freeze({
    formatId: summary.formatId,
    access,
    summary: freezeSummary(summary),
    labelsPath: safePath(labelsPath),
    ...kinds ? { metadataKinds: kinds } : {}
  });
}
function checkFormat3Option(choice) {
  if (choice !== void 0 && choice !== "keep" && choice !== "view" && choice !== "edit" && choice !== "ask") {
    throw new TypeError(
      `format3 must be "keep", "view", "edit" or "ask", got ${JSON.stringify(choice)}.`
    );
  }
}
function isFormat3(formatId) {
  return formatId >= 3;
}
function metadataKindFromH5(meta, kindAttr) {
  if (!meta || !Array.isArray(meta.shape) || meta.shape.length !== 1) {
    return null;
  }
  switch (meta.type) {
    case 0:
      return kindAttrValue(kindAttr) === "bool" ? "bool" : "int";
    case 1:
      return "float";
    case 3:
      return "str";
    case 8: {
      const names = Object.keys(meta.enum_type?.members ?? {}).sort();
      return names.length === 2 && names[0] === "FALSE" && names[1] === "TRUE" ? "bool" : "int";
    }
    default:
      return null;
  }
}
function kindAttrValue(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "string") return value.replace(/\0+$/, "");
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value).replace(/\0+$/, "");
  }
  if (typeof value === "object" && "value" in value) {
    return kindAttrValue(value.value);
  }
  return null;
}
function checkMetadataColumns(table, columns, rows, labelsPath) {
  for (const [key, column] of Object.entries(columns)) {
    if (column.values.length !== rows || column.present !== null && column.present.length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table}/metadata/${key} without one row per record (${rows}).`,
        3
      );
    }
  }
}
function metadataColumn(kind, values, present) {
  if (kind === null || values === null || values === void 0) return null;
  if (typeof values !== "object" || !("length" in values)) {
    return null;
  }
  return {
    kind,
    values,
    present: present === null || present === void 0 ? null : present
  };
}
function metadataKindsOf(columns) {
  const out = {};
  for (const [key, column] of Object.entries(columns ?? {})) {
    out[key] = column.kind;
  }
  return out;
}

// src/codecs/slp/jsfive.ts
import * as hdf5 from "jsfive";
function openJsfiveFile(source, filename) {
  let buffer;
  if (source instanceof Uint8Array) {
    const slice = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    );
    buffer = slice;
  } else {
    buffer = source;
  }
  const file = new hdf5.File(buffer, filename ?? "data.slp");
  return {
    get: (path) => {
      try {
        const item = file.get(path);
        if (!item) return null;
        return item;
      } catch {
        return null;
      }
    },
    keys: file.keys,
    close: () => {
    }
  };
}
function isDataset(item) {
  if (!item) return false;
  return "value" in item || "shape" in item;
}
function isGroup(item) {
  if (!item) return false;
  return "keys" in item && !("value" in item);
}
function getAttrs(item) {
  if (!item) return {};
  return item.attrs ?? {};
}
function getShape(item) {
  if (!item || !isDataset(item)) return [];
  return item.shape ?? [];
}
function getValue(item) {
  if (!item || !isDataset(item)) return null;
  try {
    return item.value;
  } catch {
    return null;
  }
}

// src/codecs/slp/preview.ts
function checkPreviewOption(preview) {
  if (preview === void 0 || preview === "auto") {
    return { mode: "auto", count: 1 };
  }
  if (typeof preview === "boolean") {
    return preview ? { mode: "explicit", count: 1 } : { mode: "off", count: 0 };
  }
  if (typeof preview === "number") {
    if (!Number.isInteger(preview) || preview < 0) {
      throw new Error(
        `preview count must be a non-negative integer, got ${preview}.`
      );
    }
    return preview === 0 ? { mode: "off", count: 0 } : { mode: "explicit", count: preview };
  }
  throw new Error(
    `preview must be "auto", a boolean, or a non-negative integer, got ${JSON.stringify(preview)}.`
  );
}
function toNumberArray(raw) {
  if (!raw || typeof raw !== "object" || !("length" in raw)) return [];
  return Array.from(raw, (v) => Number(v));
}
function toByteArray(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = raw;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(raw)) return Uint8Array.from(raw);
  return new Uint8Array(0);
}
function buildPreviewEntries(vidIdxs, frameIdxs, origWidths, origHeights, widths, heights, starts, ends, blob) {
  const n = Math.min(
    vidIdxs.length,
    frameIdxs.length,
    origWidths.length,
    origHeights.length,
    widths.length,
    heights.length,
    starts.length,
    ends.length
  );
  const out = [];
  for (let i = 0; i < n; i++) {
    const videoIdx = vidIdxs[i];
    const s = starts[i];
    const e = ends[i];
    if (videoIdx < 0 || s < 0 || e <= s || e > blob.byteLength) continue;
    out.push({
      videoIdx,
      frameIdx: frameIdxs[i],
      origWidth: origWidths[i],
      origHeight: origHeights[i],
      width: widths[i],
      height: heights[i],
      data: blob.slice(s, e)
    });
  }
  return out;
}
var REQUIRED_PREVIEW_DATASETS = [
  "video",
  "frame_idx",
  "orig_width",
  "orig_height",
  "width",
  "height",
  "data_start",
  "data_end",
  "data"
];
function readPreviewH5(file, videos) {
  const rootKeys = file.keys?.() ?? [];
  if (!rootKeys.includes("preview")) return [];
  const grp = file.get("preview");
  if (!grp || typeof grp.keys !== "function") return [];
  const keys = grp.keys();
  if (!REQUIRED_PREVIEW_DATASETS.every((k) => keys.includes(k))) return [];
  const getCol = (name) => grp.get(name)?.value;
  const entries = buildPreviewEntries(
    toNumberArray(getCol("video")),
    toNumberArray(getCol("frame_idx")),
    toNumberArray(getCol("orig_width")),
    toNumberArray(getCol("orig_height")),
    toNumberArray(getCol("width")),
    toNumberArray(getCol("height")),
    toNumberArray(getCol("data_start")),
    toNumberArray(getCol("data_end")),
    toByteArray(getCol("data"))
  );
  const out = [];
  for (const e of entries) {
    if (e.videoIdx >= 0 && e.videoIdx < videos.length) {
      out.push(
        new PreviewFrame({
          video: videos[e.videoIdx],
          frameIdx: e.frameIdx,
          origWidth: e.origWidth,
          origHeight: e.origHeight,
          width: e.width,
          height: e.height,
          data: e.data
        })
      );
    }
  }
  return out;
}
async function readPreviewStreaming(file, videos) {
  try {
    if (!file.keys().includes("preview")) return [];
    const [vid, fidx, ow, oh, w, h, starts, ends, blob] = await Promise.all(
      REQUIRED_PREVIEW_DATASETS.map(
        (k) => file.getDatasetValue(`preview/${k}`)
      )
    );
    const entries = buildPreviewEntries(
      toNumberArray(vid.value),
      toNumberArray(fidx.value),
      toNumberArray(ow.value),
      toNumberArray(oh.value),
      toNumberArray(w.value),
      toNumberArray(h.value),
      toNumberArray(starts.value),
      toNumberArray(ends.value),
      toByteArray(blob.value)
    );
    const out = [];
    for (const e of entries) {
      if (e.videoIdx >= 0 && e.videoIdx < videos.length) {
        out.push(
          new PreviewFrame({
            video: videos[e.videoIdx],
            frameIdx: e.frameIdx,
            origWidth: e.origWidth,
            origHeight: e.origHeight,
            width: e.width,
            height: e.height,
            data: e.data
          })
        );
      }
    }
    return out;
  } catch {
    return [];
  }
}
function readPreviewJsfive(file) {
  if (!file.keys.includes("preview")) return [];
  const grp = file.get("preview");
  if (!isGroup(grp)) return [];
  const keys = grp.keys;
  if (!REQUIRED_PREVIEW_DATASETS.every((k) => keys.includes(k))) return [];
  const getCol = (name) => getValue(file.get(`preview/${name}`));
  return buildPreviewEntries(
    toNumberArray(getCol("video")),
    toNumberArray(getCol("frame_idx")),
    toNumberArray(getCol("orig_width")),
    toNumberArray(getCol("orig_height")),
    toNumberArray(getCol("width")),
    toNumberArray(getCol("height")),
    toNumberArray(getCol("data_start")),
    toNumberArray(getCol("data_end")),
    toByteArray(getCol("data"))
  );
}
function writePreviewH5(file, previewFrames, videos) {
  if (!previewFrames.length || !videos.length) return;
  const valid = [];
  for (const pf of previewFrames) {
    const videoIdx = videos.indexOf(pf.video);
    if (videoIdx < 0 || !pf.data || pf.data.byteLength === 0) continue;
    valid.push({ videoIdx, pf });
  }
  if (!valid.length) return;
  const n = valid.length;
  const vidIdxs = new BigInt64Array(n);
  const frameIdxs = new BigInt64Array(n);
  const origWidths = new Int32Array(n);
  const origHeights = new Int32Array(n);
  const widths = new Int32Array(n);
  const heights = new Int32Array(n);
  const starts = new BigInt64Array(n);
  const ends = new BigInt64Array(n);
  let totalBytes = 0;
  for (const { pf } of valid) totalBytes += pf.data.byteLength;
  const blob = new Uint8Array(totalBytes);
  let offset = 0;
  for (let i = 0; i < n; i++) {
    const { videoIdx, pf } = valid[i];
    vidIdxs[i] = BigInt(videoIdx);
    frameIdxs[i] = BigInt(Math.trunc(pf.frameIdx));
    origWidths[i] = Math.trunc(pf.origWidth);
    origHeights[i] = Math.trunc(pf.origHeight);
    widths[i] = Math.trunc(pf.width);
    heights[i] = Math.trunc(pf.height);
    starts[i] = BigInt(offset);
    blob.set(pf.data, offset);
    offset += pf.data.byteLength;
    ends[i] = BigInt(offset);
  }
  const grp = file.create_group("preview");
  grp.create_attribute(
    "format_version",
    BigInt64Array.from([BigInt(PREVIEW_FORMAT_VERSION)]),
    [],
    "<q"
  );
  file.create_dataset({
    name: "preview/video",
    data: vidIdxs,
    shape: [n],
    dtype: "<q"
  });
  file.create_dataset({
    name: "preview/frame_idx",
    data: frameIdxs,
    shape: [n],
    dtype: "<q"
  });
  file.create_dataset({
    name: "preview/orig_width",
    data: origWidths,
    shape: [n],
    dtype: "<i"
  });
  file.create_dataset({
    name: "preview/orig_height",
    data: origHeights,
    shape: [n],
    dtype: "<i"
  });
  file.create_dataset({
    name: "preview/width",
    data: widths,
    shape: [n],
    dtype: "<i"
  });
  file.create_dataset({
    name: "preview/height",
    data: heights,
    shape: [n],
    dtype: "<i"
  });
  file.create_dataset({
    name: "preview/data_start",
    data: starts,
    shape: [n],
    dtype: "<q"
  });
  file.create_dataset({
    name: "preview/data_end",
    data: ends,
    shape: [n],
    dtype: "<q"
  });
  file.create_dataset({
    name: "preview/data",
    data: blob,
    shape: [totalBytes],
    dtype: "<B"
  });
}
function selectPreviewCandidates(labels, videos, eligibleVidIdxs, targetCount, excludeKeys) {
  if (targetCount <= 0 || eligibleVidIdxs.size === 0) return [];
  const tier0 = [];
  const tier1 = [];
  const tier2 = [];
  const seen = new Set(excludeKeys);
  const add = (tier, vIdx, fIdx) => {
    const key = `${vIdx}:${fIdx}`;
    if (!seen.has(key)) {
      seen.add(key);
      tier.push([vIdx, fIdx]);
    }
  };
  if (labels.isLazy && labels._lazyDataStore) {
    const store = labels._lazyDataStore;
    const fVids = store.framesData.video ?? [];
    const fIdxs = store.framesData.frame_idx ?? [];
    const starts = store.framesData.instance_id_start ?? [];
    const ends = store.framesData.instance_id_end ?? [];
    const instTypes = store.instancesData.instance_type ?? [];
    const annKeys = /* @__PURE__ */ new Set();
    for (const m of [
      store._bboxByFrame,
      store._maskByFrame,
      store._centroidByFrame,
      store._roiByFrame,
      store._labelImageByFrame
    ]) {
      for (const k of m.keys()) annKeys.add(k);
    }
    const rows = [];
    const nRows = Math.min(fVids.length, fIdxs.length);
    for (let i = 0; i < nRows; i++) {
      const vIdx = Number(fVids[i]);
      const fIdx = Number(fIdxs[i]);
      if (eligibleVidIdxs.has(vIdx) && fIdx >= 0) {
        rows.push([vIdx, fIdx, Number(starts[i] ?? 0), Number(ends[i] ?? 0)]);
      }
    }
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [vIdx, fIdx, iStart, iEnd] of rows) {
      if (iEnd > iStart) {
        let hasUser = false;
        for (let k = iStart; k < iEnd && k < instTypes.length; k++) {
          if (Number(instTypes[k]) === 0) {
            hasUser = true;
            break;
          }
        }
        add(hasUser ? tier0 : tier1, vIdx, fIdx);
      } else if (annKeys.has(`${vIdx}:${fIdx}`)) {
        add(tier1, vIdx, fIdx);
      } else {
        add(tier2, vIdx, fIdx);
      }
    }
    for (const key of [...annKeys].sort()) {
      const [vs, fs] = key.split(":");
      const vIdx = Number(vs);
      const fIdx = Number(fs);
      if (eligibleVidIdxs.has(vIdx) && fIdx >= 0) add(tier1, vIdx, fIdx);
    }
  } else {
    const videoIndex = /* @__PURE__ */ new Map();
    videos.forEach((v, i) => {
      videoIndex.set(v, i);
    });
    const frameRows = [];
    for (const lf of labels.labeledFrames) {
      const vIdx = videoIndex.get(lf.video) ?? -1;
      if (eligibleVidIdxs.has(vIdx) && lf.frameIdx >= 0) {
        frameRows.push([vIdx, lf.frameIdx, lf]);
      }
    }
    frameRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [vIdx, fIdx, lf] of frameRows) {
      if (lf.userInstances.length > 0) {
        add(tier0, vIdx, fIdx);
      } else if (lf.instances.length > 0 || lf.bboxes.length > 0 || lf.masks.length > 0 || lf.centroids.length > 0 || lf.rois.length > 0 || lf.labelImages.length > 0) {
        add(tier1, vIdx, fIdx);
      } else {
        add(tier2, vIdx, fIdx);
      }
    }
  }
  const tier3 = [];
  for (const vIdx of [...eligibleVidIdxs].sort((a, b) => a - b)) {
    add(tier3, vIdx, 0);
  }
  const selected = [];
  for (const tier of [tier0, tier1, tier2, tier3]) {
    const remaining = targetCount - selected.length;
    if (remaining <= 0) break;
    if (!tier.length) continue;
    if (tier.length <= remaining) {
      selected.push(...tier);
    } else if (remaining === 1) {
      selected.push(tier[0]);
    } else {
      const used = /* @__PURE__ */ new Set();
      for (let i = 0; i < remaining; i++) {
        const idx = Math.floor(i * (tier.length - 1) / (remaining - 1));
        if (!used.has(idx)) {
          used.add(idx);
          selected.push(tier[idx]);
        }
      }
      for (let idx = 0; idx < tier.length && selected.length < targetCount; idx++) {
        if (!used.has(idx)) selected.push(tier[idx]);
      }
    }
  }
  return selected.slice(0, targetCount);
}
async function resolvePreviewFrames(labels, options = {}) {
  const { mode, count } = checkPreviewOption(options.preview);
  const targetVideos = options.targetVideos ?? labels.videos;
  const readVideos = options.readVideos ?? labels.videos;
  if (mode === "off" || count <= 0 || targetVideos.length === 0) {
    return [];
  }
  if (mode === "auto" && options.doEmbed) {
    return [];
  }
  const targetVideoIndex = /* @__PURE__ */ new Map();
  targetVideos.forEach((v, i) => {
    targetVideoIndex.set(v, i);
  });
  const labelVideoIndex = /* @__PURE__ */ new Map();
  labels.videos.forEach((v, i) => {
    labelVideoIndex.set(v, i);
  });
  const existing = [];
  const existingKeys = /* @__PURE__ */ new Set();
  for (const pf of labels.previewFrames ?? []) {
    if (!pf.data || pf.data.byteLength === 0) continue;
    let vIdx = targetVideoIndex.get(pf.video) ?? -1;
    if (vIdx < 0) {
      const origIdx = labelVideoIndex.get(pf.video) ?? -1;
      if (origIdx >= 0 && origIdx < targetVideos.length) vIdx = origIdx;
    }
    if (vIdx < 0) continue;
    const key = `${vIdx}:${pf.frameIdx}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const targetVideo = targetVideos[vIdx];
    existing.push(
      pf.video === targetVideo ? pf : new PreviewFrame({
        video: targetVideo,
        frameIdx: pf.frameIdx,
        origWidth: pf.origWidth,
        origHeight: pf.origHeight,
        width: pf.width,
        height: pf.height,
        data: pf.data
      })
    );
  }
  if (mode === "auto" && existing.length > 0) {
    return existing;
  }
  if (existing.length >= count) {
    return existing.slice(0, count);
  }
  const eligibleVidIdxs = /* @__PURE__ */ new Set();
  for (let i = 0; i < targetVideos.length; i++) {
    const readVid = readVideos[i] ?? targetVideos[i];
    if (!readVid) continue;
    if (mode === "auto") {
      if (readVid.backend && !readVid.hasEmbeddedImages) {
        eligibleVidIdxs.add(i);
      }
    } else {
      if (readVid.backend || targetVideos[i]?.backend) {
        eligibleVidIdxs.add(i);
      }
    }
  }
  if (eligibleVidIdxs.size === 0) {
    return existing;
  }
  const needed = count - existing.length;
  const candidates = selectPreviewCandidates(
    labels,
    labels.videos,
    eligibleVidIdxs,
    Math.max(needed, needed + 3),
    existingKeys
  );
  const result = [...existing];
  const maxSize = options.maxSize ?? DEFAULT_PREVIEW_MAX_SIZE;
  const quality = options.quality ?? DEFAULT_PREVIEW_QUALITY;
  for (const [vIdx, fIdx] of candidates) {
    if (result.length >= count) break;
    const targetVideo = targetVideos[vIdx];
    const readVid = (readVideos[vIdx]?.backend ? readVideos[vIdx] : targetVideo) ?? targetVideo;
    if (!readVid?.backend) continue;
    try {
      const frame = await readVid.backend.getFrame(fIdx, {
        prefetch: false,
        scrub: true
      });
      if (!frame) continue;
      const pf = await createPreviewFrameFromVideoFrame(
        targetVideo,
        fIdx,
        frame,
        {
          maxSize,
          quality,
          channelOrder: readVid.backend.embeddedChannelOrder,
          rawShape: readVid.shape ?? readVid.backend.shape ?? void 0
        }
      );
      result.push(pf);
    } catch {
    }
  }
  return result;
}

// src/codecs/slp/parsers.ts
var textDecoder = new TextDecoder();
function parseJsonAttr(attr) {
  if (!attr) return null;
  const value = attr.value ?? attr;
  if (typeof value === "string") return JSON.parse(value);
  if (value instanceof Uint8Array) return JSON.parse(textDecoder.decode(value));
  if (value && typeof value === "object" && "buffer" in value) {
    return JSON.parse(
      textDecoder.decode(
        new Uint8Array(value.buffer)
      )
    );
  }
  if (value && typeof value === "object") {
    return value;
  }
  return JSON.parse(String(value));
}
function hasMetadataJsonAttr(attr) {
  if (attr === void 0 || attr === null) return false;
  const value = attr.value ?? attr;
  if (typeof value === "string") return value.length > 0;
  if (value instanceof Uint8Array) return value.length > 0;
  if (value && typeof value === "object" && "buffer" in value) {
    return new Uint8Array(value.buffer).length > 0;
  }
  return true;
}
function missingMetadataJsonError(labelsPath) {
  return new Error(
    `The SLEAP labels file '${labelsPath}' is missing its required metadata JSON blob (the 'metadata' HDF5 group has no readable 'json' attribute) and is likely corrupt. If you have a working .slp file with the same skeleton, you can copy the attribute into a BACKUP COPY of the corrupt file with h5py (back up first):
    import h5py
    with h5py.File('working.slp', 'r') as src, h5py.File('corrupt_copy.slp', 'a') as dst:
        dst['metadata'].attrs['json'] = src['metadata'].attrs['json']
Only do this if the skeletons match exactly, otherwise the loaded data will be wrong.`
  );
}
function parseMetadataJson(attr, labelsPath) {
  if (!hasMetadataJsonAttr(attr)) {
    throw missingMetadataJsonError(labelsPath);
  }
  return parseJsonAttr(attr);
}
function trimHdf5String(str) {
  return str.trim().replace(/\0+$/, "");
}
function attrToString(attr) {
  if (attr === void 0 || attr === null) return void 0;
  if (typeof attr === "string") return trimHdf5String(attr);
  if (attr instanceof Uint8Array)
    return trimHdf5String(textDecoder.decode(attr));
  if (typeof attr === "object" && "value" in attr) {
    const v = attr.value;
    if (typeof v === "string") return trimHdf5String(v);
    if (v instanceof Uint8Array) return trimHdf5String(textDecoder.decode(v));
  }
  return void 0;
}
function attrToNumber(attr) {
  if (attr === void 0 || attr === null) return void 0;
  let raw = attr;
  if (typeof attr === "object" && "value" in attr) {
    raw = attr.value;
  }
  if (typeof raw !== "number" && typeof raw !== "bigint" && typeof raw !== "string") {
    return void 0;
  }
  const num = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return Number.isFinite(num) ? num : void 0;
}
function datasetValueToString(value) {
  const norm = (s) => {
    const t = trimHdf5String(s);
    return t.length ? t : void 0;
  };
  if (value === void 0 || value === null) return void 0;
  if (typeof value === "string") return norm(value);
  if (value instanceof Uint8Array) return norm(textDecoder.decode(value));
  if (value instanceof ArrayBuffer) {
    return norm(textDecoder.decode(new Uint8Array(value)));
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    return norm(
      textDecoder.decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      )
    );
  }
  if (Array.isArray(value)) {
    return value.length ? datasetValueToString(value[0]) : void 0;
  }
  if (typeof value === "object") {
    const obj = value;
    if (obj.buffer instanceof ArrayBuffer) {
      return norm(textDecoder.decode(new Uint8Array(obj.buffer)));
    }
    if ("value" in obj && obj.value !== value) {
      return datasetValueToString(obj.value);
    }
  }
  return void 0;
}
function parseJsonEntry(entry) {
  if (typeof entry === "string") return JSON.parse(trimHdf5String(entry));
  if (entry instanceof Uint8Array)
    return JSON.parse(trimHdf5String(textDecoder.decode(entry)));
  if (entry && typeof entry === "object" && "buffer" in entry) {
    return JSON.parse(
      trimHdf5String(
        textDecoder.decode(
          new Uint8Array(entry.buffer)
        )
      )
    );
  }
  return entry;
}
function decodeEntryText(entry) {
  if (typeof entry === "string") return trimHdf5String(entry);
  if (entry instanceof Uint8Array)
    return trimHdf5String(textDecoder.decode(entry));
  if (entry && typeof entry === "object" && "buffer" in entry)
    return trimHdf5String(
      textDecoder.decode(
        new Uint8Array(entry.buffer)
      )
    );
  return void 0;
}
function sessionsReadError(nEntries, entry, cause) {
  const text = decodeEntryText(entry);
  const blank = text === "" || text === void 0;
  const plural = nEntries === 1 ? "entry" : "entries";
  const why = blank ? "an entry read back empty \u2014 the variable-length string likely exceeds the h5wasm read limit (~0.45 GB), so calibration, frame grouping, and 3D cannot be recovered from this reader" : `an entry could not be parsed as JSON${cause ? ` (${String(cause?.message ?? cause)})` : ""}`;
  return new Error(
    `Failed to read sessions: sessions_json is present (${nEntries} ${plural}) but ${why}. Refusing to load a sessions-less (2D-only) view of a file that contains session data, to avoid silently overwriting it on the next save.`
  );
}
function resolveEdgeType(edgeType, cache, state) {
  if (!edgeType || typeof edgeType !== "object") return 1;
  const et = edgeType;
  if (et["py/reduce"]) {
    const reduce = et["py/reduce"];
    const tuple = reduce[1]?.["py/tuple"];
    const typeId = tuple?.[0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (et["py/tuple"]) {
    const tuple = et["py/tuple"];
    const typeId = tuple[0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (et["py/id"]) {
    const pyId = et["py/id"];
    return cache.get(pyId) ?? pyId;
  }
  return 1;
}
function parseSkeletons(metadataJson) {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const meta = metadataJson;
  const nodeNames = (meta.nodes ?? []).map(
    (node) => typeof node === "object" ? node.name ?? "" : String(node)
  );
  const skeletonEntries = meta.skeletons ?? [];
  const skeletons = [];
  for (const entry of skeletonEntries) {
    const edges = [];
    const symmetries = [];
    const typeCache = /* @__PURE__ */ new Map();
    const typeState = { nextId: 1 };
    const graphSrc = entry.nx_graph && typeof entry.nx_graph === "object" ? entry.nx_graph : entry;
    const entryNodes = graphSrc.nodes ?? [];
    const skeletonNodeIds = entryNodes.map(
      (node) => Number(typeof node === "object" ? node.id ?? 0 : node)
    );
    const nodeOrder = skeletonNodeIds.length ? skeletonNodeIds : nodeNames.map((_, index) => index);
    const nodes = nodeOrder.map((nodeId) => nodeNames[nodeId]).filter((name) => name !== void 0).map((name) => new Node(name));
    const nodeIndexById = /* @__PURE__ */ new Map();
    nodeOrder.forEach((nodeId, index) => {
      nodeIndexById.set(Number(nodeId), index);
    });
    const links = graphSrc.links ?? [];
    for (const link of links) {
      const source = Number(link.source);
      const target = Number(link.target);
      const edgeType = resolveEdgeType(link.type, typeCache, typeState);
      if (edgeType === 2) {
        symmetries.push([source, target]);
      } else {
        edges.push([source, target]);
      }
    }
    const remapPair = (pair) => {
      const sourceIndex = nodeIndexById.get(pair[0]);
      const targetIndex = nodeIndexById.get(pair[1]);
      if (sourceIndex === void 0 || targetIndex === void 0) return null;
      return [sourceIndex, targetIndex];
    };
    const mappedEdges = edges.map(remapPair).filter((pair) => pair !== null);
    const seenSymmetries = /* @__PURE__ */ new Set();
    const mappedSymmetries = symmetries.map(remapPair).filter((pair) => pair !== null).filter(([a, b]) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seenSymmetries.has(key)) return false;
      seenSymmetries.add(key);
      return true;
    });
    const graph = graphSrc.graph;
    const skeleton = new Skeleton({
      nodes,
      edges: mappedEdges,
      symmetries: mappedSymmetries,
      name: graph?.name ?? entry.name
    });
    skeletons.push(skeleton);
  }
  return skeletons;
}
function parseTracks(values) {
  const tracks = [];
  for (const entry of values) {
    let parsed = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(trimHdf5String(entry));
      } catch {
        parsed = trimHdf5String(entry);
      }
    } else if (entry instanceof Uint8Array) {
      try {
        parsed = JSON.parse(trimHdf5String(textDecoder.decode(entry)));
      } catch {
        parsed = trimHdf5String(textDecoder.decode(entry));
      }
    }
    if (Array.isArray(parsed)) {
      tracks.push(new Track(String(parsed[1] ?? parsed[0])));
    } else if (parsed && typeof parsed === "object" && "name" in parsed) {
      tracks.push(new Track(String(parsed.name)));
    } else {
      tracks.push(new Track(String(parsed)));
    }
  }
  return tracks;
}
function resolveVideoFilename(backendMeta, parsed) {
  const filenames = backendMeta.filenames;
  if (Array.isArray(filenames) && filenames.length > 0) {
    return filenames;
  }
  return backendMeta.filename ?? parsed.filename ?? "";
}
function parseVideosMetadata(values, labelsPath) {
  const videos = [];
  for (const entry of values) {
    if (!entry) continue;
    let parsed;
    if (typeof entry === "string") {
      parsed = JSON.parse(trimHdf5String(entry));
    } else if (entry instanceof Uint8Array) {
      parsed = JSON.parse(trimHdf5String(textDecoder.decode(entry)));
    } else {
      parsed = entry;
    }
    const backendMeta = parsed.backend ?? {};
    let filename = resolveVideoFilename(backendMeta, parsed);
    const dataset = backendMeta.dataset ?? null;
    let embedded = false;
    if (filename === ".") {
      embedded = true;
      filename = labelsPath ?? "embedded";
    }
    const shape = backendMeta.shape;
    videos.push({
      filename,
      dataset: dataset ?? void 0,
      format: backendMeta.format,
      width: shape?.[2],
      height: shape?.[1],
      channels: shape?.[3],
      frameCount: shape?.[0],
      fps: backendMeta.fps,
      channelOrder: backendMeta.channel_order,
      grayscale: backendMeta.grayscale,
      embedded,
      sourceVideo: parsed.source_video
    });
  }
  return videos;
}
function parseSuggestions(values) {
  const suggestions = [];
  for (const entry of values) {
    const parsed = parseJsonEntry(entry);
    suggestions.push({
      video: Number(parsed.video ?? 0),
      frameIdx: parsed.frame_idx ?? parsed.frameIdx ?? 0,
      metadata: parsed
    });
  }
  return suggestions;
}
var SESSION_STRUCTURE_KEYS = /* @__PURE__ */ new Set([
  "calibration",
  "camcorder_to_video_idx_map",
  "fg_start",
  "fg_end",
  "frame_group_dicts"
]);
function sessionMetadataFromJson(parsed) {
  const metadata = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (SESSION_STRUCTURE_KEYS.has(key) || key === "metadata") continue;
    metadata[key] = value;
  }
  const nested = parsed.metadata;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    Object.assign(metadata, nested);
  } else if (nested !== void 0) {
    metadata.metadata = nested;
  }
  return metadata;
}
function parseSessionsMetadata(values, sessionData, skeletons = []) {
  const sessions = [];
  for (const entry of values) {
    let parsed;
    try {
      parsed = parseJsonEntry(entry);
    } catch (err) {
      throw sessionsReadError(values.length, entry, err);
    }
    if (!parsed || typeof parsed !== "object") {
      throw sessionsReadError(values.length, entry);
    }
    const calibration = parsed.calibration ?? {};
    const cameras = [];
    const cameraObjs = [];
    for (const [key, data] of Object.entries(calibration)) {
      if (key === "metadata") continue;
      const cameraData = data;
      const rvec = cameraData.rotation ?? [0, 0, 0];
      const tvec = cameraData.translation ?? [
        0,
        0,
        0
      ];
      const name = cameraData.name ?? key;
      const matrix = cameraData.matrix;
      const distortions = cameraData.distortions;
      cameras.push({ name, rvec, tvec, matrix, distortions });
      cameraObjs.push(
        new Camera({
          name,
          rvec,
          tvec,
          matrix,
          distortions,
          size: normalizeCameraSize(cameraData.size)
        })
      );
    }
    const videosByCamera = {};
    const map = parsed.camcorder_to_video_idx_map ?? {};
    for (const [cameraKey, videoIdx] of Object.entries(map)) {
      videosByCamera[cameraKey] = Number(videoIdx);
    }
    let frameGroups;
    const fgStart = parsed.fg_start;
    if (fgStart != null && sessionData) {
      frameGroups = [
        ...reconstructColumnarFrameGroups(
          cameraObjs,
          skeletons,
          void 0,
          sessionData,
          Number(fgStart),
          Number(parsed.fg_end)
        ).values()
      ];
    }
    sessions.push({
      cameras,
      videosByCamera,
      metadata: sessionMetadataFromJson(parsed),
      ...frameGroups ? { frameGroups } : {}
    });
  }
  return sessions;
}
function normalizeCameraSize(raw) {
  return Array.isArray(raw) && raw.length === 2 ? [Number(raw[0]), Number(raw[1])] : void 0;
}
function resolveCameraKey(cameraKey, cameraMap, cameras) {
  let camera = cameraMap.get(cameraKey);
  if (!camera) {
    const idx = Number(cameraKey);
    if (!isNaN(idx) && idx >= 0 && idx < cameras.length) {
      camera = cameras[idx];
    }
  }
  return camera;
}
function coerceInline3dPoints(raw) {
  const width = raw.find((r) => r != null)?.length ?? 3;
  return raw.map(
    (row) => row == null ? new Array(width).fill(Number.NaN) : row.map((v) => v == null ? Number.NaN : Number(v))
  );
}
function coerceInline1d(raw) {
  return raw.map((v) => v == null ? Number.NaN : Number(v));
}
function reconstructInstance3D(record, skeletons) {
  const rawPoints = record.points;
  if (!Array.isArray(rawPoints)) return void 0;
  const pointsValue = coerceInline3dPoints(rawPoints);
  const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
  const score = record.instance_3d_score;
  const rawScores = record.instance_3d_point_scores;
  const pointScores = Array.isArray(rawScores) ? coerceInline1d(rawScores) : void 0;
  if (pointScores) {
    return new PredictedInstance3D({
      points: pointsValue,
      skeleton,
      score,
      pointScores
    });
  }
  return new Instance3D({ points: pointsValue, skeleton, score });
}
function decodeMetaBlob(arr, idx) {
  if (!arr || idx >= arr.length) return {};
  const text = decodeEntryText(arr[idx]);
  if (!text) return {};
  return JSON.parse(text);
}
function reconstructColumnarFrameGroups(cameras, skeletons, identities, sessionData, fgStart, fgEnd) {
  const result = /* @__PURE__ */ new Map();
  const fg = sessionData.frameGroups;
  const ig = sessionData.instanceGroups;
  const mem = sessionData.members;
  const num = (col2, i) => Number(col2?.[i]);
  for (let f = fgStart; f < fgEnd; f++) {
    const frameIdx = num(fg.frame_idx, f);
    const igStart = num(fg.ig_start, f);
    const igEnd = num(fg.ig_end, f);
    const instanceGroups = [];
    let labeledFrameRefsByCamera;
    for (let g = igStart; g < igEnd; g++) {
      const memberStart = num(ig.member_start, g);
      const memberEnd = num(ig.member_end, g);
      let instanceRefsByCamera;
      for (let m = memberStart; m < memberEnd; m++) {
        const camera = cameras[num(mem.camera, m)];
        if (!camera) continue;
        const lf = num(mem.lf, m);
        const inst = num(mem.inst, m);
        if (!instanceRefsByCamera) instanceRefsByCamera = /* @__PURE__ */ new Map();
        instanceRefsByCamera.set(camera, [lf, inst]);
        if (!labeledFrameRefsByCamera) labeledFrameRefsByCamera = /* @__PURE__ */ new Map();
        labeledFrameRefsByCamera.set(camera, lf);
      }
      let instance3d;
      const pts3dStart = num(ig.pts3d_start, g);
      if (pts3dStart >= 0) {
        const pts3dEnd = num(ig.pts3d_end, g);
        const predicted = num(ig.pts3d_predicted, g) !== 0;
        const src = predicted ? sessionData.predPoints3d : sessionData.points3d;
        if (src) {
          const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
          const i3dScore = num(ig.instance_3d_score, g);
          const score2 = Number.isNaN(i3dScore) ? void 0 : i3dScore;
          const points = [];
          const pointScores = [];
          const { flat, ncols } = src;
          for (let r = pts3dStart; r < pts3dEnd; r++) {
            const base = r * ncols;
            points.push([
              Number(flat[base]),
              Number(flat[base + 1]),
              Number(flat[base + 2])
            ]);
            if (predicted) pointScores.push(Number(flat[base + 3]));
          }
          instance3d = predicted ? new PredictedInstance3D({ points, skeleton, score: score2, pointScores }) : new Instance3D({ points, skeleton, score: score2 });
        }
      }
      const scoreRaw = num(ig.score, g);
      const score = Number.isNaN(scoreRaw) ? void 0 : scoreRaw;
      let identity;
      const identityIdx = num(ig.identity_idx, g);
      if (identityIdx >= 0 && identities) {
        if (identityIdx < identities.length) identity = identities[identityIdx];
        else
          console.warn(
            `identity_idx ${identityIdx} is out of bounds (${identities.length} identities available) \u2014 skipping identity for this instance group.`
          );
      }
      instanceGroups.push(
        new InstanceGroup({
          instanceRefsByCamera,
          score,
          instance3d,
          identity,
          metadata: decodeMetaBlob(sessionData.instanceGroupMeta, g)
        })
      );
    }
    result.set(
      frameIdx,
      new FrameGroup({
        frameIdx,
        instanceGroups,
        labeledFrameRefsByCamera,
        metadata: decodeMetaBlob(sessionData.frameGroupMeta, f)
      })
    );
  }
  return result;
}
function resolveIdentity(record, identities) {
  const identityIdx = record.identity_idx;
  if (identityIdx == null || !identities) return void 0;
  const idx = Number(identityIdx);
  if (idx >= 0 && idx < identities.length) {
    return identities[idx];
  }
  console.warn(
    `identity_idx ${idx} is out of bounds (${identities.length} identities available) \u2014 skipping identity for this instance group.`
  );
  return void 0;
}

// src/codecs/slp/streaming-coverage.ts
var STREAMING_UNREAD_TOP_LEVEL = [
  "rois",
  "roi_wkb",
  "roi_categories",
  "roi_names",
  "roi_sources",
  "masks",
  "mask_rle",
  "mask_categories",
  "mask_names",
  "mask_sources",
  "mask_score_map_index",
  "mask_score_maps",
  "label_images",
  "label_image_objects",
  "label_image_data",
  "label_image_sources",
  "label_image_obj_categories",
  "label_image_obj_names",
  "label_image_score_map_index",
  "label_image_score_maps"
];
var OWNER_INSTANCE = 0;
function streamingUnreadMembers(options) {
  const out = STREAMING_UNREAD_TOP_LEVEL.filter(
    (name) => options.root.includes(name)
  );
  for (const [path, types] of Object.entries(options.owners)) {
    if (types === null || types.some((t) => t !== OWNER_INSTANCE)) {
      out.push(path);
    }
  }
  return out.sort();
}

export {
  _registerCentroidFactory,
  _registerBboxFactory,
  Track,
  pointsEmpty,
  predictedPointsEmpty,
  clonePoint,
  pointsFromArray,
  predictedPointsFromArray,
  PointView,
  Instance,
  PredictedInstance,
  pointsFromDict,
  predictedPointsFromDict,
  Node,
  Edge,
  Symmetry,
  Skeleton,
  sourceMarkOf,
  markSource,
  copySourceMark,
  takeViewMark,
  sessionRecords,
  markSessionSource,
  markFrameSource,
  keepSourceMark,
  markFromSources,
  setSourceAccess,
  encodeJpegPixels,
  encodePngPixels,
  encodedChannelCount,
  needsRedBlueSwap,
  isImageBitmapLike,
  isImageDataLike,
  encodeImageDataToPng,
  encodeBitmapToPng,
  isEncodedBytes,
  toReadableFrame,
  decodeEncoded,
  decodeEmbeddedImage,
  decodeEmbeddedRaw,
  PREVIEW_FORMAT_VERSION,
  DEFAULT_PREVIEW_MAX_SIZE,
  DEFAULT_PREVIEW_QUALITY,
  PreviewFrame,
  encodePreviewJpeg,
  createPreviewFrameFromPixels,
  createPreviewFrameFromVideoFrame,
  rodriguesTransformation,
  Camera,
  CameraGroup,
  InstanceGroup,
  FrameGroup,
  RecordingSession,
  injectSessionFrameResolver,
  cloneRecordingSession,
  makeCameraFromDict,
  ColumnCarry,
  CarrySession,
  warnDropped,
  warnDroppedCarry,
  SLP_FORMAT_ID_LIMIT,
  SLP_SUPPORTED_FEATURES,
  SlpFormatError,
  SlpTableError,
  checkSlpFormat,
  VIDEO_IS_INDEX,
  METADATA_SUBGROUP,
  isKnownPoseColumn,
  unknownColumns,
  poseTableFromColumns,
  isColumnarTable,
  skipsInstanceRow,
  hasSkippedInstanceRows,
  countUnlabeledPoints,
  checkPoseTables,
  negativeFrameKeysFromFrames,
  FORMAT3_TABLES,
  TABLE_SPECS,
  isKnownTableColumn,
  unknownTableColumns,
  unknownTableGroups,
  tableFromColumns,
  tableRows,
  reportTableProblems,
  roiProblems,
  maskProblems,
  scoreMapProblems,
  labelImageProblems,
  linkProblems,
  sessionProblems,
  POSE_TABLES,
  CARRIED_TABLES,
  METADATA_TABLES,
  isUnknownColumn,
  isCarriable,
  carriedColumn,
  unreadTableMembers,
  unreadMetadataMembers,
  sessionCarryOwners,
  buildColumnCarry,
  metadataRecord,
  metadataKeys,
  metadataKeysOf,
  Instance3D,
  PredictedInstance3D,
  LOSSLESS_FORMAT3_ASKS,
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
  PARTLY_READ_GROUPS,
  unreadMembers,
  buildFormat3Summary,
  chooseFormat3Access,
  checkFormat3Option,
  isFormat3,
  metadataKindFromH5,
  checkMetadataColumns,
  metadataColumn,
  metadataKindsOf,
  openJsfiveFile,
  isDataset,
  isGroup,
  getAttrs,
  getShape,
  getValue,
  checkPreviewOption,
  readPreviewH5,
  readPreviewStreaming,
  readPreviewJsfive,
  writePreviewH5,
  resolvePreviewFrames,
  parseJsonAttr,
  missingMetadataJsonError,
  parseMetadataJson,
  attrToString,
  attrToNumber,
  datasetValueToString,
  parseJsonEntry,
  decodeEntryText,
  sessionsReadError,
  parseSkeletons,
  parseTracks,
  resolveVideoFilename,
  parseVideosMetadata,
  parseSuggestions,
  sessionMetadataFromJson,
  parseSessionsMetadata,
  normalizeCameraSize,
  resolveCameraKey,
  reconstructInstance3D,
  reconstructColumnarFrameGroups,
  resolveIdentity,
  streamingUnreadMembers
};
