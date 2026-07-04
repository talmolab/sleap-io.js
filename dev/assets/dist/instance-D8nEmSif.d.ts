declare class Node {
    name: string;
    constructor(name: string);
}
declare class Edge {
    source: Node;
    destination: Node;
    constructor(source: Node, destination: Node);
    at(index: number): Node;
}
declare class Symmetry {
    nodes: Set<Node>;
    constructor(nodes: Iterable<Node>);
    at(index: number): Node;
}
type NodeOrIndex = Node | string | number;
declare class Skeleton {
    nodes: Node[];
    edges: Edge[];
    symmetries: Symmetry[];
    name?: string;
    private nameToNode;
    private nodeToIndex;
    constructor(options: {
        nodes: Array<Node | string>;
        edges?: Array<Edge | [NodeOrIndex, NodeOrIndex]>;
        symmetries?: Array<Symmetry | [NodeOrIndex, NodeOrIndex]>;
        name?: string;
    } | Array<Node | string>);
    rebuildCache(nodes?: Node[]): void;
    get nodeNames(): string[];
    index(node: NodeOrIndex): number;
    node(node: NodeOrIndex): Node;
    get edgeIndices(): Array<[number, number]>;
    get symmetryNames(): Array<[string, string]>;
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
    matches(other: Skeleton, opts?: {
        requireSameOrder?: boolean;
    }): boolean;
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
    nodeSimilarities(other: Skeleton): {
        nCommon: number;
        nSelfOnly: number;
        nOtherOnly: number;
        jaccard: number;
        dice: number;
    };
    addEdge(source: NodeOrIndex, destination: NodeOrIndex): void;
    addSymmetry(left: NodeOrIndex, right: NodeOrIndex): void;
    private edgeFrom;
    private symmetryFrom;
}

type CentroidFactory = (instance: Instance | PredictedInstance, options?: {
    method?: string;
    node?: string | number;
}) => any;
declare function _registerCentroidFactory(factory: CentroidFactory): void;
declare class Track {
    name: string;
    constructor(name?: string);
    matches(other: Track, method?: string): boolean;
}
type Point = {
    xy: [number, number];
    visible: boolean;
    complete: boolean;
    score?: number;
    name?: string;
};
type PredictedPoint = Point & {
    score: number;
};
type PointsArray = Point[];
type PredictedPointsArray = PredictedPoint[];
/**
 * The SLP readers' parsed point columns (`x`/`y`/`visible`/`complete`[/`score`]),
 * as plain `number[]` (eager reader) or `Float64Array` (streaming worker). Fed to
 * {@link Instance._fromColumns} to build an instance without a `Point[]`.
 */
interface PointColumns {
    x?: ArrayLike<number>;
    y?: ArrayLike<number>;
    visible?: ArrayLike<number>;
    complete?: ArrayLike<number>;
    score?: ArrayLike<number>;
}
declare function pointsEmpty(length: number, names?: string[]): PointsArray;
declare function predictedPointsEmpty(length: number, names?: string[]): PredictedPointsArray;
/**
 * Deep-copy a point into a fresh plain literal, optionally under a new node
 * name. Use this instead of `{ ...point }`: `instance.points[i]` returns a
 * {@link PointView} flyweight whose fields are accessors (not own enumerable
 * properties), so a spread would silently drop `visible`/`complete`/`score`.
 * The `score` field is copied only when present (predicted points).
 */
declare function clonePoint(p: Point, name?: string): Point;
declare function pointsFromArray(array: number[][], names?: string[]): PointsArray;
declare function predictedPointsFromArray(array: number[][], names?: string[]): PredictedPointsArray;
/**
 * A live view of one keypoint over an {@link Instance}'s columnar storage.
 *
 * `instance.points[i]` returns one of these instead of a stored `{xy,...}`
 * object, so a project's keypoints live in a few packed typed arrays per
 * instance (~a few bytes/point) rather than an object graph (~150 B/point). It
 * satisfies the structural `Point` type: reads go straight to the columns, and
 * writes (`point.xy = [...]`, `point.visible = ...`) write back through. `xy`
 * getter returns a fresh `[x, y]` copy — no code mutates `point.xy[0]` in place
 * (verified), and returning a copy keeps callers that stash `point.xy` by
 * reference (e.g. centroid math) reading a stable snapshot.
 */
declare class PointView {
    #private;
    constructor(owner: Instance, i: number);
    get xy(): [number, number];
    set xy(v: ArrayLike<number>);
    get visible(): boolean;
    set visible(v: boolean);
    get complete(): boolean;
    set complete(v: boolean);
    get score(): number | undefined;
    set score(v: number | undefined);
    get name(): string | undefined;
    set name(v: string | undefined);
}
declare class Instance {
    skeleton: Skeleton;
    track?: Track | null;
    fromPredicted?: PredictedInstance | null;
    trackingScore: number;
    _xy: Float64Array;
    _visible: Uint8Array;
    _complete: Uint8Array;
    _score: Float64Array | null;
    _names: (string | undefined)[] | null;
    _n: number;
    constructor(options: {
        points: PointsArray | Record<string, number[]>;
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    });
    /** Pack a transient `Point[]` into the columnar typed-array storage. */
    _ingest(pts: PointsArray): void;
    /**
     * Fill the columnar storage directly from the SLP readers' parsed point
     * columns over `[start, end)`, skipping the intermediate `Point[]` literals
     * (the slicePoints → pointsFromArray → `_ingest` path allocates ~3 throwaway
     * objects per point). Values match that path exactly: `x ?? NaN`, `y ?? NaN`,
     * `Boolean(visible)`, `Boolean(complete)`, and (predicted) `score ?? NaN`;
     * names derive from the skeleton. Used by {@link Instance._fromColumns}.
     */
    _fillFromColumns(columns: PointColumns, start: number, end: number, predicted: boolean): void;
    /**
     * Build an Instance directly from reader point columns over `[start, end)`,
     * without materializing a `Point[]`. Internal fast path for buildLabeledFrames;
     * equivalent to `new Instance({ points: pointsFromArray(slicePoints(...)) })`.
     */
    static _fromColumns(opts: {
        columns: PointColumns;
        start: number;
        end: number;
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    }): Instance;
    /** Lazily allocate the score column (for a user instance gaining scores). */
    _scoreColumn(): Float64Array;
    /** Node name for point `i` — derived from the skeleton unless overridden. */
    _pointName(i: number): string | undefined;
    _setPointName(i: number, v: string | undefined): void;
    /** The keypoints as an array of live {@link PointView}s (built on demand). */
    get points(): PointsArray;
    set points(pts: PointsArray);
    static fromArray(points: number[][], skeleton: Skeleton): Instance;
    static fromNumpy(options: {
        pointsData: number[][];
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    }): Instance;
    static empty(options: {
        skeleton: Skeleton;
    }): Instance;
    get length(): number;
    get nVisible(): number;
    getPoint(target: number | string | Node): Point;
    numpy(options?: {
        invisibleAsNaN?: boolean;
    }): number[][];
    toString(): string;
    /** Mean of visible point coordinates as `[x, y]`, or `null` if no points visible. */
    get centroidXy(): [number, number] | null;
    /**
     * Create a Centroid from this instance.
     *
     * @param method - "centerOfMass" (default), "bboxCenter", or "anchor".
     * @param node - Node specification for "anchor" method.
     * @returns UserCentroid or PredictedCentroid depending on instance type.
     */
    toCentroid(method?: string, node?: string | number): any;
    get isEmpty(): boolean;
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
    samePoseAs(other: Instance, tolerance?: number | null): boolean;
    /**
     * Check if this instance has the same identity (track) as another instance.
     *
     * Mirrors Python `Instance.same_identity_as` (instance.py:755-770). Compares
     * tracks by reference identity, not by name.
     *
     * @param other - Another instance to compare with.
     * @returns `true` if both instances share the same `Track` object.
     */
    sameIdentityAs(other: Instance): boolean;
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
    overlapsWith(other: Instance, iouThreshold?: number): boolean;
    /**
     * Get the bounding box of visible points.
     *
     * Mirrors Python `Instance.bounding_box` (instance.py:832-849).
     *
     * @returns `[[minX, minY], [maxX, maxY]]` over visible points, or `null` if
     *   there are no visible points.
     */
    boundingBox(): [[number, number], [number, number]] | null;
}
declare class PredictedInstance extends Instance {
    score: number;
    constructor(options: {
        points: PredictedPointsArray | Record<string, number[]>;
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
        fromPredicted?: PredictedInstance | null;
    });
    static fromArray(points: number[][], skeleton: Skeleton, score?: number): PredictedInstance;
    static fromNumpy(options: {
        pointsData: number[][];
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
    }): PredictedInstance;
    static empty(options: {
        skeleton: Skeleton;
    }): PredictedInstance;
    /**
     * Build a PredictedInstance directly from reader point columns over
     * `[start, end)`, without materializing a `Point[]`. Internal fast path for
     * buildLabeledFrames; equivalent to `new PredictedInstance({ points:
     * predictedPointsFromArray(slicePoints(...)) })`.
     */
    static _fromColumns(opts: {
        columns: PointColumns;
        start: number;
        end: number;
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
        fromPredicted?: PredictedInstance | null;
    }): PredictedInstance;
    numpy(options?: {
        scores?: boolean;
        invisibleAsNaN?: boolean;
    }): number[][];
    toString(): string;
}
declare function pointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PointsArray;
declare function predictedPointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PredictedPointsArray;

export { Edge as E, Instance as I, Node as N, PredictedInstance as P, Skeleton as S, Track as T, _registerCentroidFactory as _, Symmetry as a, type Point as b, type PredictedPoint as c, type PointsArray as d, type PredictedPointsArray as e, type PointColumns as f, predictedPointsEmpty as g, clonePoint as h, pointsFromArray as i, predictedPointsFromArray as j, PointView as k, pointsFromDict as l, predictedPointsFromDict as m, type NodeOrIndex as n, pointsEmpty as p };
