/**
 * Keeping the unknown columns of a format 3.0 file while reading it (see
 * `column-carry.ts`): which datasets of a table are unknown, how to read one
 * so it can be written back, and which records own each table's rows.
 *
 * This module has no HDF5 dependency: the readers hand it the member names and
 * the datasets' values and types.
 */

import {
  isKnownPoseColumn,
  METADATA_SUBGROUP,
  type PoseTableName,
} from "./columnar.js";
import {
  FORMAT3_TABLES,
  type Format3TableName,
  isKnownTableColumn,
  TABLE_SPECS,
} from "./columnar-tables.js";
import {
  type CarriedColumn,
  type CarriedTable,
  ColumnCarry,
} from "./column-carry.js";

/** The pose tables, whose unknown columns lazy labels always write back. */
export const POSE_TABLES: readonly PoseTableName[] = [
  "frames",
  "instances",
  "points",
  "pred_points",
];

/** Every table whose unknown columns are carried. */
export const CARRIED_TABLES: readonly string[] = [
  ...POSE_TABLES,
  ...FORMAT3_TABLES,
];

/**
 * Whether `name`, a dataset of the 3.0 table `table`, is a column this
 * version does not know (and not the table's byte buffer).
 */
export function isUnknownColumn(table: string, name: string): boolean {
  if (name === METADATA_SUBGROUP) return false;
  if ((POSE_TABLES as readonly string[]).includes(table)) {
    return !isKnownPoseColumn(table as PoseTableName, name);
  }
  const spec = TABLE_SPECS[table as Format3TableName];
  if (!spec) return false;
  return (
    name !== spec.buffer && !isKnownTableColumn(table as Format3TableName, name)
  );
}

/** What the HDF5 readers report about a dataset, as h5wasm describes it. */
export interface DatasetInfo {
  shape?: number[] | null;
  type?: number;
  size?: number;
  signed?: boolean;
}

/**
 * An unknown column as read, ready to write back, or `null` for one that is
 * not a 1-D numeric or string dataset (not carried). Booleans (an h5py enum)
 * are written back as `uint8`, which h5wasm can write.
 */
export function carriedColumn(
  info: DatasetInfo | null | undefined,
  values: unknown,
): CarriedColumn | null {
  if (!info || !Array.isArray(info.shape) || info.shape.length !== 1) {
    return null;
  }
  if (values === null || values === undefined) return null;
  const size = info.size ?? 8;
  let dtype: string;
  switch (info.type) {
    case 0: {
      const chars: Record<number, string> = { 1: "b", 2: "h", 4: "i", 8: "q" };
      const c = chars[size];
      if (!c) return null;
      dtype = `<${info.signed === false ? c.toUpperCase() : c}`;
      break;
    }
    case 1:
      dtype = size === 4 ? "<f" : "<d";
      break;
    case 3:
      dtype = "S";
      break;
    case 8:
      dtype = "<B";
      break;
    default:
      return null;
  }
  if (dtype === "S") {
    const list = Array.from(values as ArrayLike<unknown>, (v) =>
      v instanceof Uint8Array
        ? new TextDecoder().decode(v).replace(/\0+$/, "")
        : String(v ?? ""),
    );
    return { values: list, dtype };
  }
  if (typeof values !== "object" || !("length" in (values as object))) {
    return null;
  }
  return {
    values: values as ArrayLike<number> | ArrayLike<bigint>,
    dtype,
  };
}

/** The unknown columns read from a file, by table and column. */
export type UnknownColumns = Record<string, Record<string, CarriedColumn>>;

/** A record owning rows of a table, or `undefined` when unknown. */
type Owner = object | undefined;

/**
 * Keys of `owners`, or `null` when any is missing (the rows can then not be
 * attributed, and a save drops the columns with a warning).
 */
function keysOf(owners: readonly Owner[]): unknown[][] | null {
  if (owners.some((o) => o === undefined)) return null;
  return owners.map((o) => [o]);
}

/**
 * The instances owning a point table's rows, in row order, keyed with their
 * point arrays, or `null` unless they own the rows back to back from the first
 * to the last (`rows`).
 */
function pointOwnerKeys(
  spans: Array<[start: number, end: number, owner: Owner, points: unknown]>,
  rows: number,
): unknown[][] | null {
  spans.sort((a, b) => a[0] - b[0]);
  let position = 0;
  for (const [start, end, owner] of spans) {
    if (start !== position || owner === undefined) return null;
    position = end;
  }
  return position === rows
    ? spans.map(([, , owner, points]) => [owner, points])
    : null;
}

/** What {@link buildColumnCarry} attributes the rows of each table to. */
export interface CarryOwners {
  /** The `/frames` rows' frames, in row order. */
  frames?: readonly Owner[];
  /** The `/instances` rows' instances, in row order. */
  instances?: readonly Owner[];
  /** `instance_type` and point ranges of each `/instances` row. */
  instanceRows?: {
    type: ArrayLike<number>;
    start: ArrayLike<number>;
    end: ArrayLike<number>;
  };
  /** Rows of `/points` and `/pred_points`. */
  nPoints?: number;
  nPredPoints?: number;
  /** The point arrays of each instance (its key with the instance). */
  pointsOf?: (instance: object) => unknown;
  rois?: readonly Owner[];
  masks?: readonly Owner[];
  /** `mask_idx` of each `/masks/score_maps` row. */
  maskScoreMapOwners?: ArrayLike<number>;
  labelImages?: readonly Owner[];
  /** The objects of every label image, in row order. */
  labelImageObjects?: readonly Owner[];
  /** `li_idx` of each `/label_images/score_maps` row. */
  labelImageScoreMapOwners?: ArrayLike<number>;
  /** The `(owner_type, owner_id, catalog index)` of each link row. */
  identityLinks?: ReadonlyArray<readonly number[]>;
  categoryLinks?: ReadonlyArray<readonly number[]>;
  /** The records owning the rows of the session tables, in row order. */
  sessions?: {
    frameGroups: readonly Owner[];
    instanceGroups: readonly Owner[];
    members: ReadonlyArray<readonly unknown[]>;
  };
}

/** A recording session, as far as the carried session tables go. */
interface CarrySession {
  cameraGroup: { cameras: readonly object[] };
  frameGroups: Map<number, { instanceGroups: readonly object[] }>;
}

/**
 * The records owning the rows of the session tables read: the frame groups
 * with instance groups (in session order), their instance groups, and each
 * member row's `(instance group, camera)`, from the members' `camera` column
 * and each instance group's member range. `null` when the counts do not
 * match the tables.
 */
export function sessionCarryOwners(
  sessions: readonly CarrySession[],
  table: {
    nFrameGroups: number;
    memberStart: ArrayLike<number>;
    memberEnd: ArrayLike<number>;
    camera: ArrayLike<number>;
  },
): CarryOwners["sessions"] | undefined {
  const frameGroups: object[] = [];
  const instanceGroups: Array<[object, readonly object[]]> = [];
  for (const session of sessions) {
    for (const fg of session.frameGroups.values()) {
      if (fg.instanceGroups.length === 0) continue;
      frameGroups.push(fg);
      for (const ig of fg.instanceGroups) {
        instanceGroups.push([ig, session.cameraGroup.cameras]);
      }
    }
  }
  if (
    frameGroups.length !== table.nFrameGroups ||
    instanceGroups.length !== table.memberStart.length
  ) {
    return undefined;
  }
  const members: unknown[][] = [];
  instanceGroups.forEach(([ig, cameras], k) => {
    for (
      let r = Number(table.memberStart[k]);
      r < Number(table.memberEnd[k]);
      r++
    ) {
      members.push([ig, cameras[Number(table.camera[r])]]);
    }
  });
  return {
    frameGroups,
    instanceGroups: instanceGroups.map(([ig]) => ig),
    members,
  };
}

/**
 * Build the {@link ColumnCarry} of the unknown columns read, attributing each
 * table's rows to the records read from them. Tables whose rows cannot be
 * attributed are still carried, with no owners, so a save warns that it drops
 * them. Returns `null` when nothing is unknown.
 */
export function buildColumnCarry(
  unknown: UnknownColumns,
  owners: CarryOwners,
  tables: readonly string[] = CARRIED_TABLES,
): ColumnCarry | null {
  const entries: Array<[string, CarriedTable]> = [];
  for (const table of tables) {
    const columns = unknown[table];
    if (!columns || Object.keys(columns).length === 0) continue;
    entries.push([table, { owners: ownerKeys(table, owners), columns }]);
  }
  return entries.length > 0 ? new ColumnCarry(entries) : null;
}

/** The owner keys of one table's rows (see {@link buildColumnCarry}). */
function ownerKeys(table: string, o: CarryOwners): unknown[][] | null {
  switch (table) {
    case "frames":
      return o.frames ? keysOf(o.frames) : null;
    case "instances":
      return o.instances ? keysOf(o.instances) : null;
    case "points":
    case "pred_points": {
      if (!o.instances || !o.instanceRows) return null;
      const want = table === "points" ? 0 : 1;
      const spans: Array<[number, number, Owner, unknown]> = [];
      const { type, start, end } = o.instanceRows;
      for (let i = 0; i < type.length; i++) {
        if (Number(type[i]) !== want) continue;
        const owner = o.instances[i];
        spans.push([
          Number(start[i]),
          Number(end[i]),
          owner,
          owner && o.pointsOf ? o.pointsOf(owner) : undefined,
        ]);
      }
      return pointOwnerKeys(
        spans,
        (table === "points" ? o.nPoints : o.nPredPoints) ?? 0,
      );
    }
    case "rois":
      return o.rois ? keysOf(o.rois) : null;
    case "masks":
      return o.masks ? keysOf(o.masks) : null;
    case "masks/score_maps":
      return o.masks && o.maskScoreMapOwners
        ? keysOf(Array.from(o.maskScoreMapOwners, (i) => o.masks?.[Number(i)]))
        : null;
    case "label_images":
      return o.labelImages ? keysOf(o.labelImages) : null;
    case "label_images/objects":
      return o.labelImageObjects ? keysOf(o.labelImageObjects) : null;
    case "label_images/score_maps":
      return o.labelImages && o.labelImageScoreMapOwners
        ? keysOf(
            Array.from(
              o.labelImageScoreMapOwners,
              (i) => o.labelImages?.[Number(i)],
            ),
          )
        : null;
    case "identity/links":
      return o.identityLinks ? o.identityLinks.map((k) => [...k]) : null;
    case "categories/links":
      return o.categoryLinks ? o.categoryLinks.map((k) => [...k]) : null;
    case "session_data/frame_groups":
      return o.sessions ? keysOf(o.sessions.frameGroups) : null;
    case "session_data/instance_groups":
      return o.sessions ? keysOf(o.sessions.instanceGroups) : null;
    case "session_data/instance_group_members":
      return o.sessions?.members.every((k) => k[1] !== undefined)
        ? o.sessions.members.map((k) => [...k])
        : null;
    default:
      return null;
  }
}
