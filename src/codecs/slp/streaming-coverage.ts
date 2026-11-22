/**
 * What the streaming reader (`readSlpStreaming`) does not read, which the
 * in-memory and lazy readers do: ROIs, masks and label images in any layout,
 * and the identity and category links and embeddings of detections other than
 * instances. Shared by the streaming reader (for its format 3.0 summary and to
 * let `loadSlp` fall back to the in-memory reader) and the lite reader (so an
 * application can learn it before a full read). No HDF5 dependency.
 */

/** Top-level members the streaming reader does not read, in any layout. */
export const STREAMING_UNREAD_TOP_LEVEL: readonly string[] = [
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
];

/** Owner type of an instance in links and embeddings (Python's OWNER_INSTANCE). */
const OWNER_INSTANCE = 0;

/**
 * What a file holds that the streaming reader does not read, as paths.
 *
 * @param root The file's top-level member names.
 * @param owners For each of `identity/links`, `categories/links` and
 *   `embeddings` the file has, the owner types of its rows (for `embeddings`,
 *   of its identity and category vectors), or `null` when they cannot be read
 *   here (then the table is listed, to be safe).
 */
export function streamingUnreadMembers(options: {
  root: readonly string[];
  owners: Readonly<Record<string, readonly number[] | null>>;
}): string[] {
  const out = STREAMING_UNREAD_TOP_LEVEL.filter((name) =>
    options.root.includes(name),
  );
  for (const [path, types] of Object.entries(options.owners)) {
    if (types === null || types.some((t) => t !== OWNER_INSTANCE)) {
      out.push(path);
    }
  }
  return out.sort();
}
