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
    matches(other: Skeleton): boolean;
    addEdge(source: NodeOrIndex, destination: NodeOrIndex): void;
    addSymmetry(left: NodeOrIndex, right: NodeOrIndex): void;
    private edgeFrom;
    private symmetryFrom;
}

declare class Track {
    name: string;
    constructor(name: string);
}
type Point = {
    xy: [number, number];
    visible: boolean;
    complete: boolean;
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
    get isEmpty(): boolean;
    overlapsWith(other: Instance, iouThreshold?: number): boolean;
    boundingBox(): [number, number, number, number] | null;
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

export { Edge as E, Instance as I, Node as N, PredictedInstance as P, Skeleton as S, Track as T, type Point as a, type PredictedPoint as b, type PointsArray as c, type PredictedPointsArray as d, predictedPointsEmpty as e, pointsFromArray as f, predictedPointsFromArray as g, pointsFromDict as h, predictedPointsFromDict as i, Symmetry as j, type NodeOrIndex as k, pointsEmpty as p };
