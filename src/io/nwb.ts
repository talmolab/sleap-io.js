/**
 * NWB (Neurodata Without Borders / ndx-pose) top-level dispatcher.
 *
 * - {@link isNwbFile} sniffs whether a source opens as an NWB HDF5 file.
 * - {@link readNwb} opens the file, detects predictions (`PoseEstimation`) vs
 *   annotations (`PoseTraining`), and delegates. Predictions →
 *   {@link readNwbPredictions}; annotations → throws (M2, not yet supported);
 *   neither → throws.
 *
 * Mirrors the structure of `analysis-h5.ts` (`isAnalysisH5File` + `readLabels`).
 * Browser-safe: no Node-only imports.
 */

import type { Labels } from "../model/labels.js";
import { openH5File, nodeFileExists } from "../codecs/slp/h5.js";
import { readStringAttr } from "./h5-read-utils.js";
import { readNwbPredictions } from "./nwb-predictions.js";

/** Source types accepted by the NWB readers (subset of `openH5File`). */
export type NwbSource = string | ArrayBuffer | Uint8Array;

interface H5Group {
  keys(): string[];
  attrs?: Record<string, unknown>;
}
interface H5Root {
  get(name: string): unknown;
  keys?: () => string[];
  attrs?: Record<string, unknown>;
}

function isGroup(o: unknown): o is H5Group {
  return (
    o != null &&
    typeof o === "object" &&
    typeof (o as { keys?: unknown }).keys === "function"
  );
}

function neurodataType(entity: unknown): string | undefined {
  const attrs = (entity as { attrs?: Record<string, unknown> } | null)?.attrs;
  return readStringAttr(attrs, "neurodata_type");
}

/**
 * Check whether a source is an NWB file.
 *
 * True iff it opens as HDF5 and looks like NWB: the root carries a
 * `neurodata_type`/`nwb_version` attribute, or contains a `general` or
 * `specifications` group, or any top-level group carries a `neurodata_type`
 * attribute. Lenient enough for cross-writer files, but not a false positive on
 * an arbitrary (non-NWB) HDF5 file. Returns false on any error.
 */
export async function isNwbFile(source: NwbSource): Promise<boolean> {
  try {
    // For string paths in Node, fail fast if the file does not exist (mirrors
    // isAnalysisH5File; nodeFileExists resolves to null in the browser).
    if (typeof source === "string") {
      const exists = await nodeFileExists(source);
      if (exists === false) return false;
    }

    const { file, close } = await openH5File(source);
    try {
      const root = file as H5Root;

      // `keys()` forces the root group to be read and THROWS for broken /
      // non-HDF5 files (whereas `get` can return a truthy placeholder).
      let rootKeys: string[] = [];
      if (typeof root.keys === "function") {
        rootKeys = root.keys();
      }
      if (!Array.isArray(rootKeys)) return false;

      const attrs = root.attrs;
      if (
        readStringAttr(attrs, "neurodata_type") != null ||
        (attrs != null && "nwb_version" in attrs)
      ) {
        return true;
      }

      if (rootKeys.includes("general") || rootKeys.includes("specifications")) {
        return true;
      }

      // Any top-level group carrying a neurodata_type attr.
      for (const key of rootKeys) {
        const child = root.get(key);
        if (isGroup(child) && neurodataType(child) != null) return true;
      }

      return false;
    } finally {
      close();
    }
  } catch {
    return false;
  }
}

/**
 * Load an NWB (ndx-pose) file into a {@link Labels} object.
 *
 * Detects predictions (`PoseEstimation`) vs annotations (`PoseTraining`) by
 * walking `/processing/*`. Predictions are delegated to
 * {@link readNwbPredictions}. Annotations are not yet supported (M2). A file
 * with neither throws.
 *
 * @param source - Path/bytes accepted by `openH5File`.
 */
export async function readNwb(source: NwbSource): Promise<Labels> {
  const { file, close } = await openH5File(source);
  try {
    const root = file as H5Root;
    const processing = root.get("processing");

    let hasPredictions = false;
    let hasAnnotations = false;
    if (isGroup(processing)) {
      for (const modKey of processing.keys()) {
        const mod = root.get(`processing/${modKey}`);
        if (!isGroup(mod)) continue;
        for (const childKey of mod.keys()) {
          const child = root.get(`processing/${modKey}/${childKey}`);
          const ndt = neurodataType(child);
          if (ndt === "PoseEstimation") hasPredictions = true;
          else if (ndt === "PoseTraining") hasAnnotations = true;
        }
      }
    }

    if (hasPredictions) {
      return await readNwbPredictions(file, {
        filename: typeof source === "string" ? source : undefined,
      });
    }
    if (hasAnnotations) {
      throw new Error(
        "NWB annotations (PoseTraining) import is not yet supported.",
      );
    }
    throw new Error(
      "NWB file does not contain recognized pose data " +
        "(no PoseEstimation or PoseTraining found).",
    );
  } finally {
    close();
  }
}
