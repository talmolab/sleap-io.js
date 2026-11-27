import type { Labels } from "../../model/labels.js";
import type { Video } from "../../model/video.js";
import {
  DEFAULT_PREVIEW_MAX_SIZE,
  DEFAULT_PREVIEW_QUALITY,
  PREVIEW_FORMAT_VERSION,
  PreviewFrame,
  type PreviewMetadata,
  createPreviewFrameFromVideoFrame,
} from "../../model/preview.js";
import type { StreamingH5File } from "./h5-streaming.js";
import {
  getValue,
  isGroup,
  type JsfiveGroup,
  type openJsfiveFile,
} from "./jsfive.js";

/**
 * Preview frame embedding option for SLP writers:
 * - `"auto"` (default): preserve already-attached preview frames, skip
 *   embedded `.pkg.slp` saves, or capture 1 frame if a non-embedded video
 *   backend is already attached and readable.
 * - `true`: capture 1 preview frame (best-effort; never fails a save).
 * - `false` or `0`: omit the `/preview` group completely.
 * - positive integer `N`: store up to `N` preview frames.
 */
export type PreviewOption = "auto" | boolean | number;

export interface NormalizedPreviewOption {
  mode: "off" | "auto" | "explicit";
  count: number;
}

/** Validate and normalize `options.preview` before writing anything. */
export function checkPreviewOption(
  preview: PreviewOption | undefined,
): NormalizedPreviewOption {
  if (preview === undefined || preview === "auto") {
    return { mode: "auto", count: 1 };
  }
  if (typeof preview === "boolean") {
    return preview ? { mode: "explicit", count: 1 } : { mode: "off", count: 0 };
  }
  if (typeof preview === "number") {
    if (!Number.isInteger(preview) || preview < 0) {
      throw new Error(
        `preview count must be a non-negative integer, got ${preview}.`,
      );
    }
    return preview === 0
      ? { mode: "off", count: 0 }
      : { mode: "explicit", count: preview };
  }
  throw new Error(
    `preview must be "auto", a boolean, or a non-negative integer, got ${JSON.stringify(preview)}.`,
  );
}

function toNumberArray(raw: unknown): number[] {
  if (!raw || typeof raw !== "object" || !("length" in raw)) return [];
  return Array.from(raw as ArrayLike<number | bigint>, (v) => Number(v));
}

function toByteArray(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  return new Uint8Array(0);
}

function buildPreviewEntries(
  vidIdxs: number[],
  frameIdxs: number[],
  origWidths: number[],
  origHeights: number[],
  widths: number[],
  heights: number[],
  starts: number[],
  ends: number[],
  blob: Uint8Array,
): PreviewMetadata[] {
  const n = Math.min(
    vidIdxs.length,
    frameIdxs.length,
    origWidths.length,
    origHeights.length,
    widths.length,
    heights.length,
    starts.length,
    ends.length,
  );
  const out: PreviewMetadata[] = [];
  for (let i = 0; i < n; i++) {
    const videoIdx = vidIdxs[i];
    const s = starts[i];
    const e = ends[i];
    if (videoIdx < 0 || s < 0 || e <= s || e > blob.byteLength) continue;
    out.push({
      videoIdx,
      frameIdx: frameIdxs[i],
      origWidth: origWidths[i],
      origHeight: origHeights[i],
      width: widths[i],
      height: heights[i],
      data: blob.slice(s, e),
    });
  }
  return out;
}

const REQUIRED_PREVIEW_DATASETS = [
  "video",
  "frame_idx",
  "orig_width",
  "orig_height",
  "width",
  "height",
  "data_start",
  "data_end",
  "data",
] as const;

/** Read `/preview` group from an h5wasm File (sync). */
export function readPreviewH5(file: any, videos: Video[]): PreviewFrame[] {
  const rootKeys: string[] = file.keys?.() ?? [];
  if (!rootKeys.includes("preview")) return [];
  const grp = file.get("preview");
  if (!grp || typeof grp.keys !== "function") return [];
  const keys: string[] = grp.keys();
  if (!REQUIRED_PREVIEW_DATASETS.every((k) => keys.includes(k))) return [];

  const getCol = (name: string) => grp.get(name)?.value;
  const entries = buildPreviewEntries(
    toNumberArray(getCol("video")),
    toNumberArray(getCol("frame_idx")),
    toNumberArray(getCol("orig_width")),
    toNumberArray(getCol("orig_height")),
    toNumberArray(getCol("width")),
    toNumberArray(getCol("height")),
    toNumberArray(getCol("data_start")),
    toNumberArray(getCol("data_end")),
    toByteArray(getCol("data")),
  );
  const out: PreviewFrame[] = [];
  for (const e of entries) {
    if (e.videoIdx >= 0 && e.videoIdx < videos.length) {
      out.push(
        new PreviewFrame({
          video: videos[e.videoIdx],
          frameIdx: e.frameIdx,
          origWidth: e.origWidth,
          origHeight: e.origHeight,
          width: e.width,
          height: e.height,
          data: e.data,
        }),
      );
    }
  }
  return out;
}

/** Read `/preview` group from a StreamingH5File (async, Web Worker). */
export async function readPreviewStreaming(
  file: StreamingH5File,
  videos: Video[],
): Promise<PreviewFrame[]> {
  try {
    if (!file.keys().includes("preview")) return [];

    const [vid, fidx, ow, oh, w, h, starts, ends, blob] = await Promise.all(
      REQUIRED_PREVIEW_DATASETS.map((k) =>
        file.getDatasetValue(`preview/${k}`),
      ),
    );
    const entries = buildPreviewEntries(
      toNumberArray(vid.value),
      toNumberArray(fidx.value),
      toNumberArray(ow.value),
      toNumberArray(oh.value),
      toNumberArray(w.value),
      toNumberArray(h.value),
      toNumberArray(starts.value),
      toNumberArray(ends.value),
      toByteArray(blob.value),
    );
    const out: PreviewFrame[] = [];
    for (const e of entries) {
      if (e.videoIdx >= 0 && e.videoIdx < videos.length) {
        out.push(
          new PreviewFrame({
            video: videos[e.videoIdx],
            frameIdx: e.frameIdx,
            origWidth: e.origWidth,
            origHeight: e.origHeight,
            width: e.width,
            height: e.height,
            data: e.data,
          }),
        );
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Read `/preview` group from a jsfive HDF5 file (zero-WASM lite reader). */
export function readPreviewJsfive(
  file: ReturnType<typeof openJsfiveFile>,
): PreviewMetadata[] {
  if (!file.keys.includes("preview")) return [];
  const grp = file.get("preview");
  if (!isGroup(grp)) return [];
  const keys = (grp as JsfiveGroup).keys;
  if (!REQUIRED_PREVIEW_DATASETS.every((k) => keys.includes(k))) return [];

  const getCol = (name: string) => getValue(file.get(`preview/${name}`));
  return buildPreviewEntries(
    toNumberArray(getCol("video")),
    toNumberArray(getCol("frame_idx")),
    toNumberArray(getCol("orig_width")),
    toNumberArray(getCol("orig_height")),
    toNumberArray(getCol("width")),
    toNumberArray(getCol("height")),
    toNumberArray(getCol("data_start")),
    toNumberArray(getCol("data_end")),
    toByteArray(getCol("data")),
  );
}

/**
 * Write `/preview` group into an h5wasm File.
 * Additive: omitted completely when there are no valid preview frames.
 */
export function writePreviewH5(
  file: any,
  previewFrames: PreviewFrame[],
  videos: Video[],
): void {
  if (!previewFrames.length || !videos.length) return;

  const valid: Array<{ videoIdx: number; pf: PreviewFrame }> = [];
  for (const pf of previewFrames) {
    const videoIdx = videos.indexOf(pf.video);
    if (videoIdx < 0 || !pf.data || pf.data.byteLength === 0) continue;
    valid.push({ videoIdx, pf });
  }
  if (!valid.length) return;

  const n = valid.length;
  const vidIdxs = new BigInt64Array(n);
  const frameIdxs = new BigInt64Array(n);
  const origWidths = new Int32Array(n);
  const origHeights = new Int32Array(n);
  const widths = new Int32Array(n);
  const heights = new Int32Array(n);
  const starts = new BigInt64Array(n);
  const ends = new BigInt64Array(n);

  let totalBytes = 0;
  for (const { pf } of valid) totalBytes += pf.data.byteLength;
  const blob = new Uint8Array(totalBytes);

  let offset = 0;
  for (let i = 0; i < n; i++) {
    const { videoIdx, pf } = valid[i];
    vidIdxs[i] = BigInt(videoIdx);
    frameIdxs[i] = BigInt(Math.trunc(pf.frameIdx));
    origWidths[i] = Math.trunc(pf.origWidth);
    origHeights[i] = Math.trunc(pf.origHeight);
    widths[i] = Math.trunc(pf.width);
    heights[i] = Math.trunc(pf.height);
    starts[i] = BigInt(offset);
    blob.set(pf.data, offset);
    offset += pf.data.byteLength;
    ends[i] = BigInt(offset);
  }

  const grp = file.create_group("preview");
  grp.create_attribute(
    "format_version",
    BigInt64Array.from([BigInt(PREVIEW_FORMAT_VERSION)]),
    [],
    "<q",
  );
  file.create_dataset({
    name: "preview/video",
    data: vidIdxs,
    shape: [n],
    dtype: "<q",
  });
  file.create_dataset({
    name: "preview/frame_idx",
    data: frameIdxs,
    shape: [n],
    dtype: "<q",
  });
  file.create_dataset({
    name: "preview/orig_width",
    data: origWidths,
    shape: [n],
    dtype: "<i",
  });
  file.create_dataset({
    name: "preview/orig_height",
    data: origHeights,
    shape: [n],
    dtype: "<i",
  });
  file.create_dataset({
    name: "preview/width",
    data: widths,
    shape: [n],
    dtype: "<i",
  });
  file.create_dataset({
    name: "preview/height",
    data: heights,
    shape: [n],
    dtype: "<i",
  });
  file.create_dataset({
    name: "preview/data_start",
    data: starts,
    shape: [n],
    dtype: "<q",
  });
  file.create_dataset({
    name: "preview/data_end",
    data: ends,
    shape: [n],
    dtype: "<q",
  });
  file.create_dataset({
    name: "preview/data",
    data: blob,
    shape: [totalBytes],
    dtype: "<B",
  });
}

function selectPreviewCandidates(
  labels: Labels,
  videos: Video[],
  eligibleVidIdxs: Set<number>,
  targetCount: number,
  excludeKeys: Set<string>,
): Array<[number, number]> {
  if (targetCount <= 0 || eligibleVidIdxs.size === 0) return [];

  const tier0: Array<[number, number]> = [];
  const tier1: Array<[number, number]> = [];
  const tier2: Array<[number, number]> = [];
  const seen = new Set<string>(excludeKeys);

  const add = (tier: Array<[number, number]>, vIdx: number, fIdx: number) => {
    const key = `${vIdx}:${fIdx}`;
    if (!seen.has(key)) {
      seen.add(key);
      tier.push([vIdx, fIdx]);
    }
  };

  if (labels.isLazy && labels._lazyDataStore) {
    const store = labels._lazyDataStore;
    const fVids = store.framesData.video ?? [];
    const fIdxs = store.framesData.frame_idx ?? [];
    const starts = store.framesData.instance_id_start ?? [];
    const ends = store.framesData.instance_id_end ?? [];
    const instTypes = store.instancesData.instance_type ?? [];

    const annKeys = new Set<string>();
    for (const m of [
      store._bboxByFrame,
      store._maskByFrame,
      store._centroidByFrame,
      store._roiByFrame,
      store._labelImageByFrame,
    ]) {
      for (const k of m.keys()) annKeys.add(k);
    }

    const rows: Array<[number, number, number, number]> = [];
    const nRows = Math.min(fVids.length, fIdxs.length);
    for (let i = 0; i < nRows; i++) {
      const vIdx = Number(fVids[i]);
      const fIdx = Number(fIdxs[i]);
      if (eligibleVidIdxs.has(vIdx) && fIdx >= 0) {
        rows.push([vIdx, fIdx, Number(starts[i] ?? 0), Number(ends[i] ?? 0)]);
      }
    }
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [vIdx, fIdx, iStart, iEnd] of rows) {
      if (iEnd > iStart) {
        let hasUser = false;
        for (let k = iStart; k < iEnd && k < instTypes.length; k++) {
          if (Number(instTypes[k]) === 0) {
            hasUser = true;
            break;
          }
        }
        add(hasUser ? tier0 : tier1, vIdx, fIdx);
      } else if (annKeys.has(`${vIdx}:${fIdx}`)) {
        add(tier1, vIdx, fIdx);
      } else {
        add(tier2, vIdx, fIdx);
      }
    }
    for (const key of [...annKeys].sort()) {
      const [vs, fs] = key.split(":");
      const vIdx = Number(vs);
      const fIdx = Number(fs);
      if (eligibleVidIdxs.has(vIdx) && fIdx >= 0) add(tier1, vIdx, fIdx);
    }
  } else {
    const videoIndex = new Map<Video, number>();
    videos.forEach((v, i) => {
      videoIndex.set(v, i);
    });
    const frameRows: Array<
      [number, number, (typeof labels.labeledFrames)[number]]
    > = [];
    for (const lf of labels.labeledFrames) {
      const vIdx = videoIndex.get(lf.video) ?? -1;
      if (eligibleVidIdxs.has(vIdx) && lf.frameIdx >= 0) {
        frameRows.push([vIdx, lf.frameIdx, lf]);
      }
    }
    frameRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [vIdx, fIdx, lf] of frameRows) {
      if (lf.userInstances.length > 0) {
        add(tier0, vIdx, fIdx);
      } else if (
        lf.instances.length > 0 ||
        lf.bboxes.length > 0 ||
        lf.masks.length > 0 ||
        lf.centroids.length > 0 ||
        lf.rois.length > 0 ||
        lf.labelImages.length > 0
      ) {
        add(tier1, vIdx, fIdx);
      } else {
        add(tier2, vIdx, fIdx);
      }
    }
  }

  const tier3: Array<[number, number]> = [];
  for (const vIdx of [...eligibleVidIdxs].sort((a, b) => a - b)) {
    add(tier3, vIdx, 0);
  }

  const selected: Array<[number, number]> = [];
  for (const tier of [tier0, tier1, tier2, tier3]) {
    const remaining = targetCount - selected.length;
    if (remaining <= 0) break;
    if (!tier.length) continue;
    if (tier.length <= remaining) {
      selected.push(...tier);
    } else if (remaining === 1) {
      selected.push(tier[0]);
    } else {
      const used = new Set<number>();
      for (let i = 0; i < remaining; i++) {
        const idx = Math.floor((i * (tier.length - 1)) / (remaining - 1));
        if (!used.has(idx)) {
          used.add(idx);
          selected.push(tier[idx]);
        }
      }
      for (
        let idx = 0;
        idx < tier.length && selected.length < targetCount;
        idx++
      ) {
        if (!used.has(idx)) selected.push(tier[idx]);
      }
    }
  }
  return selected.slice(0, targetCount);
}

/**
 * Resolve the list of {@link PreviewFrame} entries to write into `/preview`.
 * Best-effort: decoding errors are caught and skipped so saving never fails.
 */
export async function resolvePreviewFrames(
  labels: Labels,
  options: {
    preview?: PreviewOption;
    doEmbed?: boolean;
    maxSize?: number;
    quality?: number;
    /** Videos array corresponding to the saved file (defaults to `labels.videos`). */
    targetVideos?: Video[];
    /** Source videos array for reading frames when `targetVideos` are restored source proxies. */
    readVideos?: Video[];
  } = {},
): Promise<PreviewFrame[]> {
  const { mode, count } = checkPreviewOption(options.preview);
  const targetVideos = options.targetVideos ?? labels.videos;
  const readVideos = options.readVideos ?? labels.videos;

  if (mode === "off" || count <= 0 || targetVideos.length === 0) {
    return [];
  }
  if (mode === "auto" && options.doEmbed) {
    return [];
  }

  const targetVideoIndex = new Map<Video, number>();
  targetVideos.forEach((v, i) => {
    targetVideoIndex.set(v, i);
  });
  const labelVideoIndex = new Map<Video, number>();
  labels.videos.forEach((v, i) => {
    labelVideoIndex.set(v, i);
  });

  // Preserve valid already-attached preview frames (remapping onto targetVideos if needed).
  const existing: PreviewFrame[] = [];
  const existingKeys = new Set<string>();
  for (const pf of labels.previewFrames ?? []) {
    if (!pf.data || pf.data.byteLength === 0) continue;
    let vIdx = targetVideoIndex.get(pf.video) ?? -1;
    if (vIdx < 0) {
      const origIdx = labelVideoIndex.get(pf.video) ?? -1;
      if (origIdx >= 0 && origIdx < targetVideos.length) vIdx = origIdx;
    }
    if (vIdx < 0) continue;
    const key = `${vIdx}:${pf.frameIdx}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const targetVideo = targetVideos[vIdx];
    existing.push(
      pf.video === targetVideo
        ? pf
        : new PreviewFrame({
            video: targetVideo,
            frameIdx: pf.frameIdx,
            origWidth: pf.origWidth,
            origHeight: pf.origHeight,
            width: pf.width,
            height: pf.height,
            data: pf.data,
          }),
    );
  }

  if (mode === "auto" && existing.length > 0) {
    return existing;
  }
  if (existing.length >= count) {
    return existing.slice(0, count);
  }

  // Pick eligible videos that already have a live non-embedded backend attached.
  const eligibleVidIdxs = new Set<number>();
  for (let i = 0; i < targetVideos.length; i++) {
    const readVid = readVideos[i] ?? targetVideos[i];
    if (!readVid) continue;
    if (mode === "auto") {
      if (readVid.backend && !readVid.hasEmbeddedImages) {
        eligibleVidIdxs.add(i);
      }
    } else {
      if (readVid.backend || targetVideos[i]?.backend) {
        eligibleVidIdxs.add(i);
      }
    }
  }

  if (eligibleVidIdxs.size === 0) {
    return existing;
  }

  const needed = count - existing.length;
  const candidates = selectPreviewCandidates(
    labels,
    labels.videos,
    eligibleVidIdxs,
    Math.max(needed, needed + 3),
    existingKeys,
  );

  const result = [...existing];
  const maxSize = options.maxSize ?? DEFAULT_PREVIEW_MAX_SIZE;
  const quality = options.quality ?? DEFAULT_PREVIEW_QUALITY;

  for (const [vIdx, fIdx] of candidates) {
    if (result.length >= count) break;
    const targetVideo = targetVideos[vIdx];
    const readVid =
      (readVideos[vIdx]?.backend ? readVideos[vIdx] : targetVideo) ??
      targetVideo;
    if (!readVid?.backend) continue;
    try {
      const frame = await readVid.backend.getFrame(fIdx, {
        prefetch: false,
        scrub: true,
      });
      if (!frame) continue;
      const pf = await createPreviewFrameFromVideoFrame(
        targetVideo,
        fIdx,
        frame,
        {
          maxSize,
          quality,
          channelOrder: readVid.backend.embeddedChannelOrder,
          rawShape: readVid.shape ?? readVid.backend.shape ?? undefined,
        },
      );
      result.push(pf);
    } catch {
      // Best-effort: skip unreadable frame / video.
    }
  }

  return result;
}
