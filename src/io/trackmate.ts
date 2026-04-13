/**
 * Read TrackMate CSV exports into sleap-io data structures.
 *
 * TrackMate (ImageJ/Fiji) exports tracking results as CSV files:
 * - `*_spots.csv` - Individual spot detections (required).
 * - `*_edges.csv` - Frame-to-frame linkages with assignment cost (optional).
 *
 * All CSVs have 4 header rows (field names, descriptions, abbreviations,
 * units) followed by data rows.
 */

import * as fs from "fs";
import * as path from "path";
import { Labels } from "../model/labels.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Track } from "../model/instance.js";
import { PredictedCentroid } from "../model/centroid.js";
import { Video } from "../model/video.js";

/** Number of header rows before data in TrackMate CSV exports. */
const HEADER_ROWS = 4;

/** Required columns in a spots CSV (used for format detection). */
const SPOTS_SIGNATURE = ["LABEL", "ID", "TRACK_ID", "QUALITY", "POSITION_X", "POSITION_Y"];

/** Options for loading TrackMate CSV files. */
export interface TrackMateOptions {
  /** Path to the edges CSV file. Auto-detected if not given. */
  edgesPath?: string;
  /** Video to associate with centroids. Can be a Video object or file path. */
  video?: Video | string;
}

/**
 * Check if a CSV file is a TrackMate spots export.
 *
 * Reads the first line and checks for the TrackMate column signature.
 */
export function isTrackMateFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString("utf-8", 0, bytesRead).split("\n")[0]?.trim() ?? "";
    const cols = firstLine.split(",");
    return SPOTS_SIGNATURE.every((sig, i) => cols[i] === sig);
  } catch {
    return false;
  }
}

/**
 * Find a sibling file by replacing `_spots` with a suffix in the stem.
 */
function findSibling(spotsPath: string, suffix: string): string | null {
  const dir = path.dirname(spotsPath);
  const base = path.basename(spotsPath, path.extname(spotsPath));
  if (!base.includes("_spots")) return null;

  const stem = base.replace("_spots", "");

  if (suffix.startsWith(".")) {
    // Looking for a non-CSV sibling (e.g., .tif video)
    for (const ext of [suffix, suffix + "f"]) {
      const candidate = path.join(dir, stem + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  } else {
    // Looking for another CSV sibling (e.g., _edges.csv)
    const candidate = path.join(dir, stem + suffix + ".csv");
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Parse an edges CSV and return a mapping of target spot ID to link cost.
 */
function parseEdges(edgesPath: string): Map<number, number> {
  const targetToCost = new Map<number, number>();
  const content = fs.readFileSync(edgesPath, "utf-8");
  const lines = content.split("\n");

  if (lines.length <= HEADER_ROWS) return targetToCost;

  // Read header to find column indices
  const header = lines[0].split(",");
  const targetCol = header.indexOf("SPOT_TARGET_ID");
  const costCol = header.indexOf("LINK_COST");

  if (targetCol === -1 || costCol === -1) return targetToCost;

  // Skip header rows, parse data
  for (let i = HEADER_ROWS; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const targetId = parseInt(cols[targetCol], 10);
    const cost = parseFloat(cols[costCol]);
    if (!isNaN(targetId) && !isNaN(cost)) {
      targetToCost.set(targetId, cost);
    }
  }

  return targetToCost;
}

/**
 * Load TrackMate CSV exports into a Labels object.
 *
 * The spots CSV is required. The edges CSV is optional but provides
 * per-link `trackingScore` (from TrackMate's `LINK_COST`).
 *
 * @param spotsPath - Path to the `*_spots.csv` file.
 * @param options - Optional loading settings.
 * @returns A Labels object with centroids, tracks, and optionally videos.
 */
export function readTrackMateCsv(
  spotsPath: string,
  options?: TrackMateOptions,
): Labels {
  if (!fs.existsSync(spotsPath)) {
    throw new Error(`Spots CSV not found: ${spotsPath}`);
  }

  // Auto-detect sibling files
  const edgesPath = options?.edgesPath ?? findSibling(spotsPath, "_edges");

  let videoObj: Video | null = null;
  if (options?.video) {
    if (typeof options.video === "string") {
      videoObj = new Video({ filename: options.video });
    } else {
      videoObj = options.video;
    }
  } else {
    const tifPath = findSibling(spotsPath, ".tif");
    if (tifPath) {
      videoObj = new Video({ filename: tifPath });
    }
  }

  // Parse edges if available
  const targetToCost = edgesPath ? parseEdges(edgesPath) : new Map<number, number>();

  // Parse spots CSV
  const content = fs.readFileSync(spotsPath, "utf-8");
  const lines = content.split("\n");

  // Read header to find column indices and validate
  const header = lines[0]?.split(",") ?? [];
  if (header.length < SPOTS_SIGNATURE.length || !SPOTS_SIGNATURE.every((sig, i) => header[i] === sig)) {
    throw new Error(
      `Not a TrackMate spots CSV. Expected columns starting with ${SPOTS_SIGNATURE.join(", ")}.`,
    );
  }

  const col: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    col[header[i]] = i;
  }

  // First pass: collect data rows and unique track IDs
  const dataRows: string[][] = [];
  const trackIds = new Set<number>();

  for (let i = HEADER_ROWS; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    dataRows.push(cols);
    const tid = cols[col["TRACK_ID"]];
    if (tid) {
      trackIds.add(parseInt(tid, 10));
    }
  }

  // Build Track objects
  const trackMap = new Map<number, Track>();
  for (const tid of [...trackIds].sort((a, b) => a - b)) {
    trackMap.set(tid, new Track(`Track_${tid}`));
  }
  const tracks = [...trackMap.values()];

  // Build PredictedCentroid objects
  const centroidsByFrame = new Map<number, PredictedCentroid[]>();
  for (const row of dataRows) {
    const spotId = parseInt(row[col["ID"]], 10);
    const tidStr = row[col["TRACK_ID"]];

    const x = parseFloat(row[col["POSITION_X"]]);
    const y = parseFloat(row[col["POSITION_Y"]]);

    const zVal = col["POSITION_Z"] !== undefined ? parseFloat(row[col["POSITION_Z"]]) : 0;
    const z = zVal !== 0 ? zVal : null;

    const frameIdx = parseInt(row[col["FRAME"]], 10);
    const score = parseFloat(row[col["QUALITY"]]);

    const track = tidStr ? trackMap.get(parseInt(tidStr, 10)) ?? null : null;
    const trackingScore = targetToCost.get(spotId) ?? null;
    const label = col["LABEL"] !== undefined ? row[col["LABEL"]] : `ID${spotId}`;

    const centroid = new PredictedCentroid({
      x,
      y,
      z,
      track,
      trackingScore,
      score,
      name: label,
      source: "trackmate",
    });
    centroidsByFrame.set(frameIdx, [...(centroidsByFrame.get(frameIdx) ?? []), centroid]);
  }

  // Assemble Labels with LabeledFrames
  const videos = videoObj ? [videoObj] : [];
  const video = videoObj ?? new Video({ filename: "" });
  const labeledFrames: LabeledFrame[] = [];
  for (const [frameIdx, frameCentroids] of [...centroidsByFrame.entries()].sort((a, b) => a[0] - b[0])) {
    labeledFrames.push(new LabeledFrame({ video, frameIdx, centroids: frameCentroids }));
  }
  const labels = new Labels({ labeledFrames, videos, tracks });
  labels.provenance["filename"] = spotsPath;
  return labels;
}

/**
 * Load TrackMate CSV exports and return a Labels object.
 *
 * Public API wrapper for readTrackMateCsv.
 *
 * @param filename - Path to the TrackMate spots CSV file.
 * @param options - Optional loading settings.
 * @returns Labels with centroids from TrackMate data.
 */
export function loadTrackMate(
  filename: string,
  options?: TrackMateOptions,
): Labels {
  return readTrackMateCsv(filename, options);
}
