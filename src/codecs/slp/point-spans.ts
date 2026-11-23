/**
 * Read-side check of instance point spans (issue #230).
 *
 * Each row of the `instances` table points at its coordinates with
 * `point_id_start:point_id_end` — a slice of `points` (user instances) or
 * `pred_points` (predicted instances). Points are positional: row `k` of the
 * slice is node `k` of the instance's skeleton. So a span whose length differs
 * from the skeleton's node count can't be read correctly. Before this check the
 * readers built such instances anyway, which silently put coordinates on the
 * wrong nodes.
 *
 * Older sleap-io.js writers produced two kinds of such files:
 *  - shifted boundaries: spans of 16 and 18 for a 17-node skeleton, with the
 *    point rows themselves intact. #230 first blamed a ≤0.5.4 span off-by-one;
 *    #231 traced its example file to the `instances` table being written as
 *    float32 (point ids above 2^24 rounded to even numbers).
 *  - an instance whose skeleton wasn't in `labels.skeletons` was saved with
 *    skeleton id 0, so its own (correct) rows sit under a skeleton with a
 *    different node count. The writer now refuses to save that.
 *
 * Python sleap-io refuses all such files (talmolab/sleap-io#551), so by default
 * we do too — with an error that says which instance, frame and video is wrong.
 * With `repair`, {@link checkPointSpans} rebuilds shifted boundaries when that
 * is provably exact, keeps the stored spans (with a warning) for the
 * skeleton-id case, and still refuses anything else (see `planRepair`).
 */
import type { Skeleton } from "../../model/skeleton.js";
import type { Video } from "../../model/video.js";
import { buildVideoIdMap } from "../../model/video-id-map.js";
import { skipsInstanceRow } from "./columnar.js";

type Columns = Record<string, ArrayLike<unknown> | undefined>;

/** One instance whose span length differs from its skeleton's node count. */
export interface PointSpanMismatch {
  /** Row of the instance in the `instances` table. */
  instanceRow: number;
  /** `"user"` (rows of `points`) or `"predicted"` (rows of `pred_points`). */
  instanceType: "user" | "predicted";
  /** `point_id_start` as stored. */
  pointStart: number;
  /** `point_id_end` as stored. */
  pointEnd: number;
  /** `point_id_end - point_id_start`. */
  span: number;
  /** Number of nodes in the instance's skeleton. */
  nodeCount: number;
  /** Skeleton name, when it has one. */
  skeletonName?: string;
  /** Frame index in the video, or `null` when no frame row owns the instance. */
  frameIdx: number | null;
  /** Index into `labels.videos`, or `null` when unknown. */
  videoIndex: number | null;
  /** Video filename, when known. */
  videoFilename?: string;
}

/**
 * Thrown when an SLP file's instance point spans don't match their skeletons'
 * node counts. Reading such a file would put coordinates on the wrong nodes.
 *
 * `mismatchCount` counts the affected instances; `first` describes the first
 * one. When the caller asked for `repairPointSpans` and the repair was refused,
 * `repairRefusedReason` says why.
 */
export class SlpPointSpanError extends Error {
  readonly mismatchCount: number;
  readonly instanceCount: number;
  readonly first: PointSpanMismatch;
  readonly repairRefusedReason?: string;

  constructor(options: {
    message: string;
    mismatchCount: number;
    instanceCount: number;
    first: PointSpanMismatch;
    repairRefusedReason?: string;
  }) {
    super(options.message);
    this.name = "SlpPointSpanError";
    this.mismatchCount = options.mismatchCount;
    this.instanceCount = options.instanceCount;
    this.first = options.first;
    this.repairRefusedReason = options.repairRefusedReason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Result of a successful {@link checkPointSpans} call. */
export interface PointSpanCheckResult {
  /** Instances whose spans were rebuilt (0 unless `repair` was needed). */
  repairedInstances: number;
  /**
   * Mismatched instances whose stored spans were kept as they are (0 unless
   * `repair` was needed); the readers load their points as stored, so their
   * point count differs from their skeleton's node count.
   */
  keptInstances: number;
}

const TABLE_NAME = { user: "points", predicted: "pred_points" } as const;

/** Row count of a column-oriented table (0 when it has no columns). */
export function columnLength(table: Columns): number {
  for (const column of Object.values(table)) {
    if (column) return column.length;
  }
  return 0;
}

/**
 * Check every instance's point span against its skeleton's node count.
 *
 * - All spans match: returns zero counts and changes nothing.
 * - Some don't and `repair` is off: throws {@link SlpPointSpanError}.
 * - Some don't and `repair` is on, per affected table (`points` /
 *   `pred_points`), see `planRepair`: rebuilds the spans in `instancesData`
 *   (replacing the `point_id_start`/`point_id_end` columns) when that's exact,
 *   keeps them when each instance's rows are provably its own, or throws
 *   {@link SlpPointSpanError}. Rebuilding or keeping logs one `console.warn`.
 *
 * `userInstancesOnly` skips predicted instances (their table isn't read).
 */
export function checkPointSpans(options: {
  framesData: Columns;
  instancesData: Columns;
  skeletons: Skeleton[];
  videos: Video[];
  /** Rows in the `points` table. */
  pointsRowCount: number;
  /** Rows in the `pred_points` table. */
  predPointsRowCount: number;
  repair?: boolean;
  userInstancesOnly?: boolean;
  /** File name used in the error message. */
  labelsPath?: string;
}): PointSpanCheckResult {
  const { instancesData, skeletons } = options;
  const starts = instancesData.point_id_start;
  const ends = instancesData.point_id_end;
  // Tables without span columns (or without a skeleton to compare against)
  // can't be checked; the readers keep their existing behaviour for those.
  if (!starts || !ends || skeletons.length === 0) {
    return { repairedInstances: 0, keptInstances: 0 };
  }
  const types = instancesData.instance_type;
  const skeletonIds = instancesData.skeleton;
  const instanceCount = starts.length;

  // Same skeleton fallback the readers use for an out-of-range id.
  const nodeCountAt = (row: number): number => {
    const sk = skeletons[Number(skeletonIds?.[row] ?? 0)] ?? skeletons[0];
    return sk.nodes.length;
  };
  const isPredictedAt = (row: number): boolean =>
    Number(types?.[row] ?? 0) !== 0;
  // Rows the readers skip (a 3.0 instance type other than user or predicted)
  // own no points they read, so their spans are not checked or repaired.
  const skipped = (row: number): boolean =>
    skipsInstanceRow(instancesData, row);

  let mismatchCount = 0;
  let firstRow = -1;
  const mismatchedTypes = { user: 0, predicted: 0 };
  for (let row = 0; row < instanceCount; row++) {
    if (skipped(row)) continue;
    const predicted = isPredictedAt(row);
    if (predicted && options.userInstancesOnly) continue;
    const span = Number(ends[row]) - Number(starts[row]);
    if (span === nodeCountAt(row)) continue;
    mismatchCount++;
    if (firstRow < 0) firstRow = row;
    mismatchedTypes[predicted ? "predicted" : "user"]++;
  }
  if (mismatchCount === 0) return { repairedInstances: 0, keptInstances: 0 };

  const fail = (repairRefusedReason?: string): never => {
    const first = describeMismatch(options, firstRow, nodeCountAt(firstRow));
    throw new SlpPointSpanError({
      message: buildMessage({
        labelsPath: options.labelsPath,
        mismatchCount,
        instanceCount,
        first,
        repairRefusedReason,
      }),
      mismatchCount,
      instanceCount,
      first,
      repairRefusedReason,
    });
  };

  if (!options.repair) return fail();

  // Check every affected table before changing anything, so a refusal leaves
  // `instancesData` untouched.
  const rebuild: number[][] = [];
  let keptInstances = 0;
  for (const type of ["user", "predicted"] as const) {
    if (!mismatchedTypes[type]) continue;
    const rowCount =
      type === "user" ? options.pointsRowCount : options.predPointsRowCount;
    const plan = planRepair(
      instanceCount,
      (row) => !skipped(row) && isPredictedAt(row) === (type === "predicted"),
      starts,
      ends,
      nodeCountAt,
      rowCount,
      TABLE_NAME[type],
    );
    if (typeof plan === "string") return fail(plan);
    if (plan.action === "rebuild") rebuild.push(plan.rows);
    else keptInstances += mismatchedTypes[type];
  }

  let repairedInstances = 0;
  if (rebuild.length > 0) {
    const newStarts = Array.from(starts, Number);
    const newEnds = Array.from(ends, Number);
    for (const rows of rebuild) {
      let next = 0;
      for (const row of rows) {
        const start = next;
        next += nodeCountAt(row);
        if (newStarts[row] !== start || newEnds[row] !== next) {
          repairedInstances++;
        }
        newStarts[row] = start;
        newEnds[row] = next;
      }
    }
    instancesData.point_id_start = newStarts;
    instancesData.point_id_end = newEnds;
  }

  const file = options.labelsPath ?? "SLP file";
  if (repairedInstances > 0) {
    console.warn(
      `[sleap-io] ${file}: rebuilt the point spans of ${repairedInstances} ` +
        "instances whose boundaries had shifted (the point rows were intact).",
    );
  }
  if (keptInstances > 0) {
    const first = describeMismatch(options, firstRow, nodeCountAt(firstRow));
    console.warn(
      `[sleap-io] ${file}: ${keptInstances} instances have more or fewer ` +
        "points than their skeleton has nodes (first: " +
        `${describeLocation(first)}, ${first.span} points vs ` +
        `${first.nodeCount} nodes). Loaded their points as stored. Older ` +
        "sleap-io.js versions wrote files like this when an " +
        "instance's skeleton was missing from the labels; check these " +
        "instances' nodes.",
    );
  }
  return { repairedInstances, keptInstances };
}

/**
 * Decide what `repair` does for one table. The rows of that type, in table
 * order, must tile the point table with no gap or overlap (each starts where
 * the previous ended, the first at 0, the last ending at the table's last
 * row); otherwise it returns why it can't repair.
 *
 * - `"rebuild"`: the table also holds exactly one row per node of every
 *   instance. The rows are intact and only the boundaries moved, so the only
 *   consistent spans are consecutive runs of each instance's node count.
 * - `"keep"`: the rows tile the table but their total differs from the
 *   skeletons' node total, so the spans can't have shifted — each instance's
 *   rows are its own and its skeleton id is what's wrong (the old writer's
 *   skeleton-0 fallback). Keep the spans; the readers load the points as
 *   stored, as they did before this check.
 */
function planRepair(
  instanceCount: number,
  isType: (row: number) => boolean,
  starts: ArrayLike<unknown>,
  ends: ArrayLike<unknown>,
  nodeCountAt: (row: number) => number,
  tableRowCount: number,
  tableName: string,
): { action: "rebuild" | "keep"; rows: number[] } | string {
  const rows: number[] = [];
  let expectedStart = 0;
  let totalNodes = 0;
  for (let row = 0; row < instanceCount; row++) {
    if (!isType(row)) continue;
    const start = Number(starts[row]);
    const end = Number(ends[row]);
    if (start !== expectedStart) {
      return `instance row ${row} starts at ${tableName} row ${start}, but the previous instance ended at row ${expectedStart}`;
    }
    if (end < start) {
      return `instance row ${row} ends (${end}) before it starts (${start})`;
    }
    expectedStart = end;
    totalNodes += nodeCountAt(row);
    rows.push(row);
  }
  if (expectedStart !== tableRowCount) {
    return `the spans cover ${expectedStart} ${tableName} rows, but the table has ${tableRowCount}`;
  }
  return { action: totalNodes === tableRowCount ? "rebuild" : "keep", rows };
}

function describeMismatch(
  options: {
    framesData: Columns;
    instancesData: Columns;
    skeletons: Skeleton[];
    videos: Video[];
  },
  row: number,
  nodeCount: number,
): PointSpanMismatch {
  const { framesData, instancesData, skeletons, videos } = options;
  const pointStart = Number(instancesData.point_id_start?.[row]);
  const pointEnd = Number(instancesData.point_id_end?.[row]);
  const skeleton =
    skeletons[Number(instancesData.skeleton?.[row] ?? 0)] ?? skeletons[0];
  const mismatch: PointSpanMismatch = {
    instanceRow: row,
    instanceType:
      Number(instancesData.instance_type?.[row] ?? 0) === 0
        ? "user"
        : "predicted",
    pointStart,
    pointEnd,
    span: pointEnd - pointStart,
    nodeCount,
    frameIdx: null,
    videoIndex: null,
  };
  if (skeleton?.name) mismatch.skeletonName = skeleton.name;

  // Find the frame row whose instance range holds this instance (only runs
  // once, on the error path).
  const instStarts = framesData.instance_id_start;
  const instEnds = framesData.instance_id_end;
  const frameCount = instStarts?.length ?? 0;
  for (let f = 0; f < frameCount; f++) {
    const lo = Number(instStarts?.[f]);
    const hi = Number(instEnds?.[f]);
    if (row < lo || row >= hi) continue;
    mismatch.frameIdx = Number(framesData.frame_idx?.[f] ?? 0);
    const rawVideoId = Number(framesData.video?.[f] ?? 0);
    const videoIndex =
      buildVideoIdMap(framesData as Record<string, unknown[]>, videos).get(
        rawVideoId,
      ) ?? rawVideoId;
    mismatch.videoIndex = videoIndex;
    const filename = videos[videoIndex]?.filename;
    if (typeof filename === "string") mismatch.videoFilename = filename;
    break;
  }
  return mismatch;
}

function describeFrame(m: PointSpanMismatch): string {
  return `frame ${m.frameIdx} of video ${m.videoIndex}${
    m.videoFilename ? ` (${m.videoFilename})` : ""
  }`;
}

/** "instance row R (frame F of video V (file))", for warnings. */
function describeLocation(m: PointSpanMismatch): string {
  return `instance row ${m.instanceRow}${
    m.frameIdx === null ? "" : `, ${describeFrame(m)}`
  }`;
}

function buildMessage(options: {
  labelsPath?: string;
  mismatchCount: number;
  instanceCount: number;
  first: PointSpanMismatch;
  repairRefusedReason?: string;
}): string {
  const { first, mismatchCount, instanceCount } = options;
  const where =
    first.frameIdx === null ? "not in any frame" : describeFrame(first);
  const skeleton = first.skeletonName
    ? `skeleton "${first.skeletonName}"`
    : "its skeleton";
  const file = options.labelsPath ? ` ${options.labelsPath}` : "";
  let message =
    `Can't read${file}: ${mismatchCount} of ${instanceCount} instances have ` +
    `a point span that doesn't match their skeleton's node count, so their ` +
    `points would land on the wrong nodes. First: instance row ` +
    `${first.instanceRow} (${first.instanceType}, ${where}) spans ` +
    `${first.span} ${TABLE_NAME[first.instanceType]} rows ` +
    `(${first.pointStart}–${first.pointEnd}), but ${skeleton} has ` +
    `${first.nodeCount} nodes.`;
  message += options.repairRefusedReason
    ? ` Repair refused: ${options.repairRefusedReason}.`
    : " Pass { repairPointSpans: true } to recover the file when its point " +
      "rows are intact (see sleap-io.js#230).";
  return message;
}
