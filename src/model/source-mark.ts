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

/** A recording session, as far as marks are concerned. */
interface MarkableSession {
  frameGroups: Map<number, { instanceGroups: object[] }>;
}

/**
 * The records of recording sessions that a file's session tables hold: every
 * frame group and instance group.
 */
export function sessionRecords(sessions: Iterable<MarkableSession>): object[] {
  const records: object[] = [];
  for (const session of sessions) {
    for (const group of session.frameGroups.values()) {
      records.push(group, ...group.instanceGroups);
    }
  }
  return records;
}

/** Mark every frame group and instance group of `sessions`. */
export function markSessionSource(
  sessions: Iterable<MarkableSession>,
  sourceFormat: SlpSourceFormat | null | undefined,
): void {
  if (!sourceFormat) return;
  for (const record of sessionRecords(sessions)) {
    markSource(record, sourceFormat);
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
 * Give `target`, built from several records (a composition), the strictest
 * mark among them: view-only if any is, else edit if any is.
 */
export function markFromSources(
  target: object,
  sources: Iterable<object | null | undefined>,
): void {
  let strictest: SlpSourceFormat | undefined;
  for (const source of sources) {
    const mark = sourceMarkOf(source);
    if (!mark) continue;
    if (!strictest || (strictest.access === "edit" && mark.access === "view")) {
      strictest = mark;
    }
  }
  if (strictest) marks.set(target, strictest);
}

/**
 * Switch the format 3.0 choice of every record `labels` hold that carries
 * one, whatever file it came from, and of `labels.sourceFormat` if set, to
 * `access`. For example, let the user edit a file first opened view-only
 * (`setSourceAccess(labels, "edit")`), or content of such a file that has
 * since been merged into a project of the user's own.
 *
 * `labels.sourceFormat` and the marks are frozen, so this is the way to change
 * the choice after loading. It switches what `labels` hold now: their frames
 * and every instance and annotation in them, their static ROIs, the frame
 * groups and instance groups of their sessions, and for lazy
 * labels their store, its annotations and the frames materialized and still
 * cached. Records held elsewhere keep the choice they had: copies in other
 * labels (switch those labels too), and a lazy frame the caller released from
 * the cache and still holds (materialize it again). A lazy copy shares its
 * annotation records with the labels it was copied from, so switching either
 * switches those annotations for both.
 *
 * @returns The number of records whose choice changed (`labels.sourceFormat`
 *   and a lazy store not counted).
 * @throws {TypeError} If `access` is not `"view"` or `"edit"`.
 */
export function setSourceAccess(
  labels: Labels,
  access: SlpSourceFormat["access"],
): number {
  if (access !== "view" && access !== "edit") {
    throw new TypeError(
      `access must be "view" or "edit", got ${JSON.stringify(access)}.`,
    );
  }
  // One new frozen source per old one, so records of one file still share it.
  const switched = new Map<SlpSourceFormat, SlpSourceFormat>();
  const switchedTo = (old: SlpSourceFormat): SlpSourceFormat => {
    if (old.access === access) return old;
    let next = switched.get(old);
    if (!next) {
      next = Object.freeze({ ...old, access });
      switched.set(old, next);
    }
    return next;
  };
  let count = 0;
  const swap = (record: object): void => {
    const old = marks.get(record);
    if (!old || old.access === access) return;
    marks.set(record, switchedTo(old));
    count += 1;
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
  if (labels.sourceFormat)
    labels.sourceFormat = switchedTo(labels.sourceFormat);
  for (const frame of labels.labeledFrames) swapFrame(frame);
  for (const roi of labels._staticRois) swap(roi);
  for (const record of sessionRecords(labels.sessions)) swap(record);
  const store = labels._lazyDataStore;
  if (store) {
    if (store.sourceFormat) store.sourceFormat = switchedTo(store.sourceFormat);
    for (const [byFrame, undistributed] of [
      [store._centroidByFrame, store._undistributedCentroids],
      [store._bboxByFrame, store._undistributedBboxes],
      [store._maskByFrame, store._undistributedMasks],
      [store._roiByFrame, store._undistributedRois],
      [store._labelImageByFrame, store._undistributedLabelImages],
    ] as Array<[Map<string, object[]>, object[]]>) {
      for (const record of undistributed) swap(record);
      for (const list of byFrame.values()) {
        for (const record of list) swap(record);
      }
    }
  }
  const lazyFrames = labels._lazyFrameList;
  if (lazyFrames) {
    for (const frame of lazyFrames._supplementary) swapFrame(frame);
    for (const frame of lazyFrames._cachedFrames()) swapFrame(frame);
  }
  return count;
}
