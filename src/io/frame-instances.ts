/**
 * Which instances of a frame stand for its animals in an analysis export.
 *
 * Shared by the Analysis HDF5 export (`analysis-h5.ts`) and the SLEAP Analysis
 * CSV export (`csv.ts`) so the two agree on one instance per animal. Ports of
 * `_max_instances_per_frame` and `_untracked_frame_instances` in Python
 * `sleap_io.codecs.numpy`. Pure and browser-safe.
 */

import type { Instance, PredictedInstance } from "../model/instance.js";
import type { LabeledFrame } from "../model/labeled-frame.js";

/**
 * Largest number of instances exported from any one frame. User and predicted
 * instances are assumed to overlap (a user instance usually replaces a
 * prediction), so a frame counts `max(nUser, nPredicted)`, not their sum.
 */
export function maxInstancesPerFrame(lfs: Iterable<LabeledFrame>): number {
  let nInstances = 0;
  for (const lf of lfs) {
    const nUser = (lf.userInstances ?? []).length;
    const nPredicted = (lf.predictedInstances ?? []).length;
    nInstances = Math.max(nInstances, nUser, nPredicted);
  }
  return nInstances;
}

/**
 * Instances of `lf` to export, one per animal, preferring user instances.
 *
 * - A prediction is dropped when a user instance in the frame links to it
 *   (`fromPredicted`) or is on the same track.
 * - With `isSingleInstance` (at most one instance per frame in the project),
 *   any user instance replaces all of the frame's predictions.
 * - Predictions nobody replaced are kept.
 *
 * Returns user instances first, then kept predictions, each in frame order.
 */
export function untrackedFrameInstances(
  lf: LabeledFrame,
  isSingleInstance: boolean,
): Array<Instance | PredictedInstance> {
  const userInsts = lf.userInstances ?? [];
  const predInsts = lf.predictedInstances ?? [];
  if (userInsts.length === 0) return [...predInsts];

  const include: Array<Instance | PredictedInstance> = [...userInsts];
  if (isSingleInstance) return include;

  for (const inst of predInsts) {
    const replaced = userInsts.some(
      (userInst) =>
        (userInst.fromPredicted != null && userInst.fromPredicted === inst) ||
        (userInst.track != null &&
          inst.track != null &&
          userInst.track === inst.track),
    );
    if (!replaced) include.push(inst);
  }
  return include;
}
