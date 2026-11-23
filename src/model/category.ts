/**
 * A class that detections belong to (e.g. species, sex, condition, "arena").
 *
 * The project-level catalog lives on `Labels.categories`. Detections keep
 * `category` as a plain string and refer to a catalog entry by `name`, so the
 * catalog can hold classes no detection uses yet (a class list defined before
 * labeling) and per-class metadata such as a display color.
 *
 * Stored in the SLP `/categories` group (format 2.7): a `name` catalog plus an
 * entity-attribute-value metadata table (`meta_owner` / `meta_key` /
 * `meta_val`). Python's `Category` has no first-class `color`, so `color` is
 * folded into `metadata["color"]` on write and lifted back out on read, exactly
 * like `Identity`.
 */
export class Category {
  name: string;
  color?: string;
  metadata: Record<string, unknown>;

  constructor(options?: {
    name?: string;
    color?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.name = options?.name ?? "";
    this.color = options?.color;
    this.metadata = options?.metadata ?? {};
  }
}

/**
 * Merge `categories` into `target` by name, appending copies of the ones it
 * lacks. Existing entries win (their color and metadata are kept). Returns
 * `target`.
 */
export function mergeCategoriesByName(
  target: Category[],
  categories: Category[],
): Category[] {
  const names = new Set(target.map((c) => c.name));
  for (const c of categories) {
    if (names.has(c.name)) continue;
    names.add(c.name);
    target.push(cloneCategory(c));
  }
  return target;
}

/** Copy a category, keeping its prototype (unlike `structuredClone`). */
export function cloneCategory(c: Category): Category {
  return new Category({
    name: c.name,
    color: c.color,
    metadata: { ...c.metadata },
  });
}

/**
 * Build a `Category` from a catalog name and its string metadata as stored in
 * SLP (`/categories/meta_*`), lifting `metadata["color"]` into `color`.
 */
export function categoryFromStored(
  name: string,
  metadata: Record<string, unknown>,
): Category {
  const color = typeof metadata.color === "string" ? metadata.color : undefined;
  const { color: _color, ...rest } = metadata;
  return new Category({ name, color, metadata: rest });
}
