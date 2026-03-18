import { Skeleton } from "../model/skeleton.js";
import { readSkeletonJson } from "./skeleton-json.js";

/**
 * Extract skeleton(s) from a SLEAP training config JSON file.
 * Training configs embed skeleton definitions in data.labels.skeletons[].
 */
export function readTrainingConfigSkeletons(
  json: string | Record<string, unknown>
): Skeleton[] {
  const data =
    typeof json === "string"
      ? (JSON.parse(json) as Record<string, unknown>)
      : json;

  const dataSection = data.data as Record<string, unknown> | undefined;
  const labels = dataSection?.labels as Record<string, unknown> | undefined;
  const skeletonsList = labels?.skeletons as
    | Array<Record<string, unknown>>
    | undefined;

  if (!skeletonsList || !skeletonsList.length) {
    throw new Error("No skeletons found in training config");
  }

  return skeletonsList.map((skeletonData) => readSkeletonJson(skeletonData));
}

/**
 * Extract the first skeleton from a SLEAP training config JSON file.
 */
export function readTrainingConfigSkeleton(
  json: string | Record<string, unknown>
): Skeleton {
  const skeletons = readTrainingConfigSkeletons(json);
  return skeletons[0];
}

/**
 * Detect whether a JSON object or string is a training config format.
 */
export function isTrainingConfig(
  json: string | Record<string, unknown>
): boolean {
  const data =
    typeof json === "string"
      ? (JSON.parse(json) as Record<string, unknown>)
      : json;
  return !!(data.data && (data.data as Record<string, unknown>).labels);
}
