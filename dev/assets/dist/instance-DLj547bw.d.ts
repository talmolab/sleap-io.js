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
declare function pointsEmpty(length: number, names?: string[]): PointsArray;
declare function predictedPointsEmpty(length: number, names?: string[]): PredictedPointsArray;
declare function pointsFromArray(array: number[][], names?: string[]): PointsArray;
declare function predictedPointsFromArray(array: number[][], names?: string[]): PredictedPointsArray;
declare class Instance {
    points: PointsArray;
    skeleton: Skeleton;
    track?: Track | null;
    fromPredicted?: PredictedInstance | null;
    trackingScore: number;
    constructor(options: {
        points: PointsArray | Record<string, number[]>;
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    });
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
    numpy(options?: {
        scores?: boolean;
        invisibleAsNaN?: boolean;
    }): number[][];
    toString(): string;
}
declare function pointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PointsArray;
declare function predictedPointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PredictedPointsArray;

export { Edge as E, Instance as I, Node as N, PredictedInstance as P, Skeleton as S, Track as T, _registerCentroidFactory as _, Symmetry as a, type Point as b, type PredictedPoint as c, type PointsArray as d, type PredictedPointsArray as e, predictedPointsEmpty as f, pointsFromArray as g, predictedPointsFromArray as h, pointsFromDict as i, predictedPointsFromDict as j, type NodeOrIndex as k, pointsEmpty as p };
