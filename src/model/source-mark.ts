/**
 * The open-time choice for a format 3.0 file, carried by its records.
 *
 * A file in SLP format 3.0 is opened with `format3: "view"` or `"edit"` (see
 * `codecs/slp/format3.ts`). The choice must hold wherever the file's content
 * goes, not only on the `Labels` it was loaded into: frames merged into other
 * labels, frames handed to `new Labels(...)` or to a streaming writer. So the
 * readers mark every labeled frame, instance and annotation they load from a
 * 3.0 file, and every place that copies a record copies its mark. Writers then
 * decide per record (see `write.ts`).
 *
 * Marks live in a module-level `WeakMap`, so records gain no property and are
 * released as usual.
 */

import type { SlpSourceFormat } from "../codecs/slp/format3.js";

const marks = new WeakMap<object, SlpSourceFormat>();

/** The source format a record was loaded with, if it came from a 3.0 file. */
export function sourceMarkOf(
  record: object | null | undefined,
): SlpSourceFormat | undefined {
  return record ? marks.get(record) : undefined;
}

/** Mark `record` as loaded with `sourceFormat` (no-op for `null`). */
export function markSource(
  record: object | null | undefined,
  sourceFormat: SlpSourceFormat | null | undefined,
): void {
  if (record && sourceFormat) marks.set(record, sourceFormat);
}

/** Give `to` the mark of `from` (a copy of a record keeps its source). */
export function copySourceMark(
  from: object | null | undefined,
  to: object | null | undefined,
): void {
  const mark = sourceMarkOf(from);
  if (mark && to) marks.set(to, mark);
}

/**
 * Give `target` the stricter of its own mark and `source`'s, for a record that
 * takes in another's content (a frame merge): view-only beats edit beats none.
 */
export function mergeSourceMark(
  target: object | null | undefined,
  source: object | null | undefined,
): void {
  const incoming = sourceMarkOf(source);
  if (!incoming || !target) return;
  const own = marks.get(target);
  if (!own || (own.access === "edit" && incoming.access === "view")) {
    marks.set(target, incoming);
  }
}

/** A labeled frame and what it holds, as far as marks are concerned. */
interface MarkableFrame {
  instances: object[];
  centroids: object[];
  bboxes: object[];
  masks: object[];
  labelImages: object[];
  rois: object[];
}

/** Mark a frame and every instance and annotation in it. */
export function markFrameSource(
  frame: MarkableFrame,
  sourceFormat: SlpSourceFormat | null | undefined,
): void {
  if (!sourceFormat) return;
  markSource(frame, sourceFormat);
  for (const list of [
    frame.instances,
    frame.centroids,
    frame.bboxes,
    frame.masks,
    frame.labelImages,
    frame.rois,
  ]) {
    for (const record of list) markSource(record, sourceFormat);
  }
}
