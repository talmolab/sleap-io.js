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

type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;
interface VideoBackend {
    filename: string | string[];
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes?(): Promise<number[] | null>;
    close(): void;
}

declare class Video {
    filename: string | string[];
    backend: VideoBackend | null;
    backendMetadata: Record<string, unknown>;
    sourceVideo: Video | null;
    openBackend: boolean;
    constructor(options: {
        filename: string | string[];
        backend?: VideoBackend | null;
        backendMetadata?: Record<string, unknown>;
        sourceVideo?: Video | null;
        openBackend?: boolean;
    });
    get originalVideo(): Video | null;
    get shape(): [number, number, number, number] | null;
    get fps(): number | null;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    matchesPath(other: Video, strict?: boolean): boolean;
}

declare class LabeledFrame {
    video: Video;
    frameIdx: number;
    instances: Array<Instance | PredictedInstance>;
    constructor(options: {
        video: Video;
        frameIdx: number;
        instances?: Array<Instance | PredictedInstance>;
    });
    get length(): number;
    [Symbol.iterator](): Iterator<Instance | PredictedInstance>;
    at(index: number): Instance | PredictedInstance | undefined;
    get userInstances(): Instance[];
    get predictedInstances(): PredictedInstance[];
    get hasUserInstances(): boolean;
    get hasPredictedInstances(): boolean;
    numpy(): number[][][];
    get image(): Promise<ImageData | ImageBitmap | ArrayBuffer | Uint8Array | null>;
    get unusedPredictions(): PredictedInstance[];
    removePredictions(): void;
    removeEmptyInstances(): void;
}

declare class SuggestionFrame {
    video: Video;
    frameIdx: number;
    metadata: Record<string, unknown>;
    constructor(options: {
        video: Video;
        frameIdx: number;
        metadata?: Record<string, unknown>;
    });
}

declare function rodriguesTransformation(input: number[][] | number[]): {
    matrix: number[][];
    vector: number[];
};
declare class Camera {
    name?: string;
    rvec: number[];
    tvec: number[];
    matrix?: number[][];
    distortions?: number[];
    constructor(options: {
        name?: string;
        rvec: number[];
        tvec: number[];
        matrix?: number[][];
        distortions?: number[];
    });
}
declare class CameraGroup {
    cameras: Camera[];
    metadata: Record<string, unknown>;
    constructor(options?: {
        cameras?: Camera[];
        metadata?: Record<string, unknown>;
    });
}
declare class InstanceGroup {
    instanceByCamera: Map<Camera, Instance>;
    score?: number;
    points?: number[][];
    metadata: Record<string, unknown>;
    constructor(options: {
        instanceByCamera: Map<Camera, Instance> | Record<string, Instance>;
        score?: number;
        points?: number[][];
        metadata?: Record<string, unknown>;
    });
    get instances(): Instance[];
}
declare class FrameGroup {
    frameIdx: number;
    instanceGroups: InstanceGroup[];
    labeledFrameByCamera: Map<Camera, LabeledFrame>;
    metadata: Record<string, unknown>;
    constructor(options: {
        frameIdx: number;
        instanceGroups: InstanceGroup[];
        labeledFrameByCamera: Map<Camera, LabeledFrame> | Record<string, LabeledFrame>;
        metadata?: Record<string, unknown>;
    });
    get cameras(): Camera[];
    get labeledFrames(): LabeledFrame[];
    getFrame(camera: Camera): LabeledFrame | undefined;
}
declare class RecordingSession {
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
    });
    get frameGroups(): Map<number, FrameGroup>;
    get videos(): Video[];
    get cameras(): Camera[];
    addVideo(video: Video, camera: Camera): void;
    getCamera(video: Video): Camera | undefined;
    getVideo(camera: Camera): Video | undefined;
}
declare function makeCameraFromDict(data: Record<string, unknown>): Camera;

declare class Labels {
    labeledFrames: LabeledFrame[];
    videos: Video[];
    skeletons: Skeleton[];
    tracks: Track[];
    suggestions: SuggestionFrame[];
    sessions: RecordingSession[];
    provenance: Record<string, unknown>;
    constructor(options?: {
        labeledFrames?: LabeledFrame[];
        videos?: Video[];
        skeletons?: Skeleton[];
        tracks?: Track[];
        suggestions?: SuggestionFrame[];
        sessions?: RecordingSession[];
        provenance?: Record<string, unknown>;
    });
    get video(): Video;
    get length(): number;
    [Symbol.iterator](): Iterator<LabeledFrame>;
    get instances(): Array<Instance | PredictedInstance>;
    find(options: {
        video?: Video;
        frameIdx?: number;
    }): LabeledFrame[];
    append(frame: LabeledFrame): void;
    toDict(options?: {
        video?: Video | number;
        skipEmptyFrames?: boolean;
    }): LabelsDict;
    static fromNumpy(data: number[][][][], options: {
        videos?: Video[];
        video?: Video;
        skeletons?: Skeleton[] | Skeleton;
        skeleton?: Skeleton;
        trackNames?: string[];
        firstFrame?: number;
        returnConfidence?: boolean;
    }): Labels;
    numpy(options?: {
        video?: Video;
        returnConfidence?: boolean;
    }): number[][][][];
}

declare class LabelsSet {
    labels: Map<string, Labels>;
    constructor(entries?: Record<string, Labels>);
    get size(): number;
    get(key: string): Labels | undefined;
    set(key: string, value: Labels): void;
    delete(key: string): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<Labels>;
    entries(): IterableIterator<[string, Labels]>;
    [Symbol.iterator](): IterableIterator<[string, Labels]>;
}

declare class Mp4BoxVideoBackend implements VideoBackend {
    filename: string;
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    private ready;
    private mp4box;
    private mp4boxFile;
    private videoTrack;
    private samples;
    private keyframeIndices;
    private cache;
    private cacheSize;
    private lookahead;
    private decoder;
    private config;
    private fileSize;
    private supportsRangeRequests;
    private fileBlob;
    private isDecoding;
    private pendingFrame;
    constructor(filename: string, options?: {
        cacheSize?: number;
        lookahead?: number;
    });
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    private init;
    private openSource;
    private readChunk;
    private extractSamples;
    private findKeyframeBefore;
    private getCodecDescription;
    private readSampleDataByDecodeOrder;
    private decodeRange;
    private addToCache;
}

type SlpSource = string | ArrayBuffer | Uint8Array | File | FileSystemFileHandle;
type StreamMode = "auto" | "range" | "download";
type OpenH5Options = {
    stream?: StreamMode;
    filenameHint?: string;
};

declare function loadSlp(source: SlpSource, options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
}): Promise<Labels>;
declare function saveSlp(labels: Labels, filename: string, options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
}): Promise<void>;
declare function loadVideo(filename: string, options?: {
    dataset?: string;
    openBackend?: boolean;
}): Promise<Video>;

type LabelsDict = {
    version: string;
    skeletons: Array<{
        name?: string;
        nodes: string[];
        edges: Array<[number, number]>;
        symmetries: Array<[number, number]>;
    }>;
    videos: Array<{
        filename: string | string[];
        shape?: number[] | null;
        fps?: number | null;
        backend?: Record<string, unknown>;
    }>;
    tracks: Array<Record<string, unknown>>;
    labeled_frames: Array<{
        frame_idx: number;
        video_idx: number;
        instances: Array<Record<string, unknown>>;
    }>;
    suggestions: Array<Record<string, unknown>>;
    provenance: Record<string, unknown>;
};
declare function toDict(labels: Labels, options?: {
    video?: Video | number;
    skipEmptyFrames?: boolean;
}): LabelsDict;
declare function fromDict(data: LabelsDict): Labels;

declare function toNumpy(labels: Labels, options?: {
    returnConfidence?: boolean;
    video?: Video;
}): number[][][][];
declare function fromNumpy(data: number[][][][], options: {
    video?: Video;
    videos?: Video[];
    skeleton?: Skeleton;
    skeletons?: Skeleton[] | Skeleton;
    returnConfidence?: boolean;
    trackNames?: string[];
    firstFrame?: number;
}): Labels;
declare function labelsFromNumpy(data: number[][][][], options: {
    video: Video;
    skeleton: Skeleton;
    trackNames?: string[];
    firstFrame?: number;
    returnConfidence?: boolean;
}): Labels;

export { Camera, CameraGroup, Edge, FrameGroup, Instance, InstanceGroup, LabeledFrame, Labels, type LabelsDict, LabelsSet, Mp4BoxVideoBackend, Node, type NodeOrIndex, type Point, type PointsArray, PredictedInstance, type PredictedPoint, type PredictedPointsArray, RecordingSession, Skeleton, SuggestionFrame, Symmetry, Track, Video, type VideoBackend, type VideoFrame, fromDict, fromNumpy, labelsFromNumpy, loadSlp, loadVideo, makeCameraFromDict, pointsEmpty, pointsFromArray, pointsFromDict, predictedPointsEmpty, predictedPointsFromArray, predictedPointsFromDict, rodriguesTransformation, saveSlp, toDict, toNumpy };
