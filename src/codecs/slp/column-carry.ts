/**
 * Unknown table columns kept from a format 3.0 file, to write them back.
 *
 * A newer writer may add columns to a table (for example `/points`, `/frames`
 * or `/masks`) that this version does not know. As Python sleap-io does, the
 * readers keep them beside the labels, and a format 3.0 save writes them back
 * when the table's rows still line up with the records that own them: the
 * same records, in the same order. Editing values in place is fine; adding,
 * removing, replacing or reordering records is not, and then the columns are
 * dropped with a warning. The 2.x layout cannot store them: a 2.x save drops
 * them (with a warning, unless the file was opened with `format3: "edit"`).
 *
 * Lazy labels keep the unknown columns of their pose tables in the store and
 * always write them back, since the lazy save writes those tables from the
 * raw rows, in order.
 *
 * This module has no HDF5 dependency.
 */

/** One unknown column: its values, one per row, and how to write it. */
export interface CarriedColumn {
  /** Numbers (or 64-bit integers), or strings for a string column. */
  values: ArrayLike<number> | ArrayLike<bigint> | readonly string[];
  /**
   * The h5wasm dtype to write it with: `"S"` for a variable-length string
   * column, else a numeric dtype such as `"<d"`, `"<q"` or `"<B"`.
   */
  dtype: string;
}

/** The unknown columns of one table, and the records owning its rows. */
export interface CarriedTable {
  /**
   * One key per record owning rows, in row order (each key a list of objects
   * or numbers, compared by identity; for the point tables, an instance and
   * its point array, which owns one row per node), or `null` when the rows
   * could not be attributed to records.
   */
  owners: ReadonlyArray<readonly unknown[]> | null;
  /** The columns, by name. */
  columns: Readonly<Record<string, CarriedColumn>>;
}

/** Unknown columns kept from a file, by table (`points`, `rois`, ...). */
export class ColumnCarry {
  readonly tables: Map<string, CarriedTable>;

  constructor(tables?: Iterable<[string, CarriedTable]>) {
    this.tables = new Map(tables ?? []);
  }

  /** Whether any table has columns to carry. */
  get size(): number {
    return this.tables.size;
  }

  /** The table names, as paths like `/points`. */
  tablePaths(): string[] {
    return [...this.tables.keys()].map((name) => `/${name}`);
  }
}

/** The rows `order` of each column, in that order. */
function permuteColumns(
  columns: Readonly<Record<string, CarriedColumn>>,
  order: readonly number[],
): Record<string, CarriedColumn> {
  const out: Record<string, CarriedColumn> = {};
  for (const [name, column] of Object.entries(columns)) {
    const values = column.values as ArrayLike<unknown>;
    const picked = order.map((row) => values[row]);
    out[name] = {
      dtype: column.dtype,
      values:
        column.dtype === "S"
          ? (picked as string[])
          : typeof picked[0] === "bigint"
            ? BigInt64Array.from(picked as bigint[])
            : Float64Array.from(picked as number[]),
    };
  }
  return out;
}

/** Whether two parts of row keys refer to the same owner. */
function sameOwner(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === "number" && typeof b === "number" && a === b);
}

/** Whether two rows' keys match, part by part. */
function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!sameOwner(a[i], b[i])) return false;
  }
  return true;
}

/** The names of a table's carried columns, for messages. */
function columnList(table: CarriedTable): string {
  return Object.keys(table.columns).join(", ");
}

/**
 * Tracks one format 3.0 save's use of a {@link ColumnCarry}: which tables it
 * offered rows for, and warns once about columns it could not write.
 */
export class CarrySession {
  private readonly carry: ColumnCarry | null;
  private readonly consumed = new Set<string>();

  constructor(carry: ColumnCarry | null | undefined) {
    this.carry = carry && carry.size > 0 ? carry : null;
  }

  /**
   * The carried columns of `table` when `keys` (one per row being written,
   * in order) are the owners the columns were read with; otherwise none, with
   * a warning when there were columns to write.
   */
  columnsFor(
    table: string,
    keys: ReadonlyArray<readonly unknown[]>,
  ): Record<string, CarriedColumn> {
    const carried = this.carry?.tables.get(table);
    if (!carried) return {};
    this.consumed.add(table);
    const owners = carried.owners;
    if (
      owners !== null &&
      owners.length === keys.length &&
      owners.every((owner, i) => sameKey(owner, keys[i]))
    ) {
      return { ...carried.columns };
    }
    // Link rows are keyed by their values (owner type, owner id, catalog
    // index), not by records: the same rows in another order still match.
    const byValue = owners !== null && table.endsWith("/links");
    if (byValue && owners.length === keys.length) {
      const rowOf = new Map<string, number>();
      owners.forEach((owner, i) => {
        rowOf.set(JSON.stringify(owner), i);
      });
      const order = keys.map((key) => rowOf.get(JSON.stringify(key)));
      if (
        rowOf.size === owners.length &&
        order.every((row) => row !== undefined)
      ) {
        return permuteColumns(carried.columns, order as number[]);
      }
    }
    warnDropped(table, carried, "changed");
    return {};
  }

  /**
   * Warn about carried columns of tables the save wrote no rows for (every
   * record of the table is gone, so its unknown columns are dropped).
   */
  finish(): void {
    if (!this.carry) return;
    for (const [table, carried] of this.carry.tables) {
      if (!this.consumed.has(table)) warnDropped(table, carried, "changed");
    }
  }
}

/**
 * Warn that unknown columns are not being saved: `"legacy"` when the 2.x
 * layout cannot store them, `"changed"` when the records changed since
 * loading.
 */
export function warnDropped(
  table: string,
  carried: CarriedTable,
  reason: "legacy" | "changed",
): void {
  const why =
    reason === "legacy"
      ? "the SLP 2.x layout cannot store them"
      : "its records changed since the file was loaded, so its rows no " +
        "longer line up";
  console.warn(
    `Unknown column(s) ${columnList(carried)} of /${table} were not saved: ` +
      `${why}.`,
  );
}

/** Warn that a 2.x save drops every carried column. */
export function warnDroppedCarry(carry: ColumnCarry | null | undefined): void {
  if (!carry) return;
  for (const [table, carried] of carry.tables) {
    warnDropped(table, carried, "legacy");
  }
}
