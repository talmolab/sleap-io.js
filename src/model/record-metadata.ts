/**
 * Per-record metadata: a dictionary of scalar values on an instance, a labeled
 * frame or a bounding box.
 *
 * SLP format 3.0 (Python sleap-io 0.10) stores each key as a column of its
 * table (`/instances/metadata/<key>`, `/frames/metadata/<key>`,
 * `/bboxes/metadata/<key>`). The 2.x layout has no place for it, so a save
 * with `slpVersion: "auto"` writes format 3.0 when there is any.
 */

/** A metadata value: one of the kinds format 3.0 can store. */
export type RecordMetadataValue = boolean | number | string;

/** The metadata of one record. */
export type RecordMetadata = Record<string, RecordMetadataValue>;

/** The kind of a metadata column on disk. */
export type MetadataKind = "bool" | "int" | "float" | "str";

/**
 * One metadata key of a table, as read: one value per record, and which
 * records hold the key (`null` when every record does).
 */
export interface MetadataColumn {
  kind: MetadataKind;
  values: ArrayLike<unknown>;
  present: ArrayLike<unknown> | null;
}

/** The metadata keys of one table, by key. */
export type MetadataColumns = Record<string, MetadataColumn>;

/** One value of a column as the model holds it. */
function metadataValue(kind: MetadataKind, raw: unknown): RecordMetadataValue {
  switch (kind) {
    case "bool":
      return Boolean(Number(raw));
    case "int":
    case "float":
      return Number(raw);
    default:
      return raw instanceof Uint8Array
        ? new TextDecoder().decode(raw).replace(/\0+$/, "")
        : String(raw ?? "");
  }
}

/**
 * The metadata of record `row` of a table: the keys that record holds.
 * Returns a fresh object each call.
 */
export function metadataRecord(
  columns: MetadataColumns | null | undefined,
  row: number,
): RecordMetadata {
  const out: RecordMetadata = {};
  if (!columns) return out;
  for (const key of Object.keys(columns)) {
    const { kind, values, present } = columns[key];
    if (present && !Number(present[row])) continue;
    out[key] = metadataValue(kind, values[row]);
  }
  return out;
}

/** The keys of `columns`, sorted. */
export function metadataKeys(
  columns: MetadataColumns | null | undefined,
): string[] {
  return columns ? Object.keys(columns).sort() : [];
}

/** The keys held by any of `records`, sorted. */
export function metadataKeysOf(
  records: Iterable<{ metadata?: RecordMetadata | null }>,
): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.metadata ?? {})) keys.add(key);
  }
  return [...keys].sort();
}
