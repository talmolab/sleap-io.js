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
 * released as usual. Every record of one file shares that file's frozen
 * `SlpSourceFormat`; {@link setSourceAccess} changes the choice afterwards.
 *
 * An application that rebuilds records itself (undo snapshots, its own copies,
 * `fromDict(toDict(...))`) carries the choice with {@link copySourceMark}.
 */

import type { SlpSourceFormat } from "../codecs/slp/format3.js";
import type { Labels } from "./labels.js";

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
 * For a record that keeps its own content but takes some from another (a
 * frame taking metadata keys or the negative flag in a merge, an instance or
 * annotation taking a track): if the other was loaded view-only, so is
 * `target` now, since it holds view-only content.
 *
 * An edit mark is not passed on this way. It would silence the warnings for
 * `target`'s own content, and the content taken from an edit-loaded file
 * only costs a warning when the record is saved as the caller's own.
 */
export function takeViewMark(
  target: object | null | undefined,
  source: object | null | undefined,
): void {
  const incoming = sourceMarkOf(source);
  if (target && incoming?.access === "view") marks.set(target, incoming);
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

/**
 * Give a record derived from `from` (or each of a list of them) `from`'s
 * mark, and return it: a conversion keeps the content's source.
 */
export function keepSourceMark<T>(from: object, out: T): T {
  if (Array.isArray(out)) {
    for (const record of out) copySourceMark(from, record as object);
  } else {
    copySourceMark(from, out as object);
  }
  return out;
}

/**
 * Switch labels loaded from a format 3.0 file, and every record they hold that
 * carries the same open-time choice, to `access`: for example, let the user
 * edit a file first opened view-only (`setSourceAccess(labels, "edit")`).
 *
 * `labels.sourceFormat` and the marks are frozen, so this is the way to change
 * the choice after loading. Records of the file that have been copied or
 * merged into other labels keep the choice they had; switch those labels too.
 *
 * @throws {Error} If the labels were not loaded from a format 3.0 file.
 * @throws {TypeError} If `access` is not `"view"` or `"edit"`.
 */
export function setSourceAccess(
  labels: Labels,
  access: SlpSourceFormat["access"],
): void {
  if (access !== "view" && access !== "edit") {
    throw new TypeError(
      `access must be "view" or "edit", got ${JSON.stringify(access)}.`,
    );
  }
  const old = labels.sourceFormat;
  if (!old) {
    throw new Error(
      "setSourceAccess: these labels were not loaded from an SLP format 3.0 file.",
    );
  }
  if (old.access === access) return;
  const next: SlpSourceFormat = Object.freeze({ ...old, access });
  const swap = (record: object): void => {
    if (marks.get(record) === old) marks.set(record, next);
  };
  const swapFrame = (frame: MarkableFrame): void => {
    swap(frame);
    for (const list of [
      frame.instances,
      frame.centroids,
      frame.bboxes,
      frame.masks,
      frame.labelImages,
      frame.rois,
    ]) {
      for (const record of list) swap(record);
    }
  };
  labels.sourceFormat = next;
  for (const frame of labels.labeledFrames) swapFrame(frame);
  for (const roi of labels._staticRois) swap(roi);
  const store = labels._lazyDataStore;
  if (store) {
    if (store.sourceFormat === old) store.sourceFormat = next;
    for (const [byFrame, undistributed] of [
      [store._centroidByFrame, store._undistributedCentroids],
      [store._bboxByFrame, store._undistributedBboxes],
      [store._maskByFrame, store._undistributedMasks],
      [store._roiByFrame, store._undistributedRois],
      [store._labelImageByFrame, store._undistributedLabelImages],
    ] as Array<[Map<string, object[]>, object[]]>) {
      for (const record of undistributed) swap(record);
      for (const list of byFrame.values())
        for (const record of list) swap(record);
    }
  }
  const lazyFrames = labels._lazyFrameList;
  if (lazyFrames) {
    for (const frame of lazyFrames._supplementary) swapFrame(frame);
    for (const frame of lazyFrames._cachedFrames()) swapFrame(frame);
  }
}
