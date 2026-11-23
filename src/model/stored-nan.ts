/**
 * Instances whose tracking score was NaN in a file before format 3.0.
 *
 * The readers read such a score as 0, as they always have, and full 2.x saves
 * write that 0. An in-place save of the same file (`buildLabelTableUpdate`)
 * writes the NaN back for these instances, so patching a file changes only
 * what was edited. Kept in a module-level `WeakSet`, so instances gain no
 * property; copies of an instance are not in it.
 */

const nanTrackingScores = new WeakSet<object>();

/** Note that `instance` was read with a NaN tracking score (read as 0). */
export function markNanTrackingScore(instance: object): void {
  nanTrackingScores.add(instance);
}

/** Whether `instance` was read with a NaN tracking score. */
export function hadNanTrackingScore(instance: object): boolean {
  return nanTrackingScores.has(instance);
}
