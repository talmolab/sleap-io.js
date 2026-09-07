/**
 * Pure, WebCodecs-free helpers shared by the on-main mp4 backend
 * ({@link Mp4BoxVideoBackend}) and the off-main worker backend
 * ({@link WorkerMp4BoxBackend} + its decode worker).
 *
 * These are the "brain" of mp4 seeking — which frames to decode for a target,
 * which cache window to keep, how to coalesce the byte reads, and decode-ahead
 * coverage — with NO dependency on `VideoDecoder`/`createImageBitmap`. That keeps
 * them unit-testable under bun (which has no WebCodecs) and lets the decode worker
 * inline a copy (see `mp4box-decode-worker.ts`, which keeps its copies in lockstep
 * with this module — the same pattern `h5-worker.ts` uses for `remote.ts`).
 *
 * @module
 */

/**
 * A demuxed mp4 sample in PRESENTATION order (mirrors the `Sample` type in
 * `mp4box-video.ts`). `decodeIndex` is the position in DECODE order; the two
 * differ whenever B-frames reorder presentation vs decode.
 */
export type Mp4Sample = {
  /** Byte offset of the sample payload in the file. */
  offset: number;
  /** Byte length of the sample payload. */
  size: number;
  /** Presentation timestamp in microseconds. */
  timestamp: number;
  /** Sample duration in microseconds. */
  duration: number;
  /** True for a sync sample (keyframe / I-frame). */
  isKeyframe: boolean;
  /** Composition time stamp (raw track timescale units), for presentation sort. */
  cts: number;
  /** Index in decode order (order chunks must be fed to the decoder). */
  decodeIndex: number;
};

/**
 * A `VideoDecoderConfig` reduced to structured-cloneable fields, so it can cross
 * a `postMessage` boundary to the decode worker. `description` is the codec
 * private data (avcC/hvcC/…); a `Uint8Array` clones fine.
 */
export interface SerializableDecoderConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
}

/**
 * Everything the off-main worker backend needs from parsing the mp4 ONCE on the
 * main thread — the sample table, keyframe indices, decoder config, and derived
 * shape/fps/size. Produced by {@link Mp4BoxVideoBackend.getParseResult} and handed
 * to {@link WorkerMp4BoxBackend}, so the worker never touches mp4box.
 */
export interface Mp4ParseResult {
  samples: Mp4Sample[];
  keyframeIndices: number[];
  config: SerializableDecoderConfig;
  shape: [number, number, number, number];
  fps?: number;
  fileSize: number;
}

/** One decode-order sample plus its PRESENTATION index (position in `samples`). */
export interface FeedEntry {
  presentationIndex: number;
  sample: Mp4Sample;
}

/** A contiguous byte region to read in one `readRange`, with its member samples. */
export interface ReadRegion {
  offset: number;
  length: number;
  members: Array<{ decodeIndex: number; size: number }>;
}

/**
 * The keyframe index at or before `frameIndex` — the cheapest frame to decode
 * near it (an I-frame with no delta chain). `keyframeIndices` must be ascending.
 * Returns 0 when there are none at/before it.
 */
export function findKeyframeBefore(
  keyframeIndices: number[],
  frameIndex: number,
): number {
  let result = 0;
  for (const keyframe of keyframeIndices) {
    if (keyframe <= frameIndex) result = keyframe;
    else break;
  }
  return result;
}

/**
 * The presentation range `[start, end]` to decode for `target`: from the keyframe
 * at/before `target` up to `target` (scrub — show only this frame) or
 * `target + lookahead` (normal — prime forward playback), clamped to the last
 * sample. Mirrors the range logic in `Mp4BoxVideoBackend.getFrame`.
 */
export function planDecodeRange(
  samplesLength: number,
  keyframeIndices: number[],
  target: number,
  opts: { scrub?: boolean; lookahead: number },
): { start: number; end: number } {
  const start = findKeyframeBefore(keyframeIndices, target);
  const end = opts.scrub
    ? target
    : Math.min(target + opts.lookahead, samplesLength - 1);
  return { start, end };
}

/**
 * The sub-range of `[start, end]` whose decoded frames are worth keeping in the
 * cache — `target ± cacheSize/2`, clamped to `[start, end]`. Frames decoded only
 * to satisfy the delta chain (outside this window) are discarded, not cached.
 */
export function computeCacheWindow(
  start: number,
  end: number,
  target: number,
  cacheSize: number,
): { cacheStart: number; cacheEnd: number } {
  const half = Math.floor(cacheSize / 2);
  return {
    cacheStart: Math.max(start, target - half),
    cacheEnd: Math.min(end, target + half),
  };
}

/**
 * The samples that must be FED to the decoder (in decode order) to decode the
 * presentation range `[start, end]`. Because presentation and decode order differ
 * with B-frames, this widens to every sample whose `decodeIndex` falls in the
 * `[min, max]` decodeIndex span of the range, then sorts by `decodeIndex`.
 * Mirrors the `toFeed` construction in `Mp4BoxVideoBackend.decodeRange`.
 */
export function selectFeedSamples(
  samples: Mp4Sample[],
  start: number,
  end: number,
): FeedEntry[] {
  let minDecodeIndex = Number.POSITIVE_INFINITY;
  let maxDecodeIndex = Number.NEGATIVE_INFINITY;
  for (let i = start; i <= end; i += 1) {
    minDecodeIndex = Math.min(minDecodeIndex, samples[i].decodeIndex);
    maxDecodeIndex = Math.max(maxDecodeIndex, samples[i].decodeIndex);
  }
  const toFeed: FeedEntry[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (
      sample.decodeIndex >= minDecodeIndex &&
      sample.decodeIndex <= maxDecodeIndex
    ) {
      toFeed.push({ presentationIndex: i, sample });
    }
  }
  toFeed.sort((a, b) => a.sample.decodeIndex - b.sample.decodeIndex);
  return toFeed;
}

/**
 * Merge decode-order samples into the fewest contiguous byte regions so a run of
 * adjacent samples is read in a single `readRange` (one IPC/HTTP round-trip)
 * instead of one per sample. Mirrors the region loop in
 * `Mp4BoxVideoBackend.readSampleDataByDecodeOrder`.
 */
export function planReadRegions(toFeed: FeedEntry[]): ReadRegion[] {
  const regions: ReadRegion[] = [];
  let i = 0;
  while (i < toFeed.length) {
    const first = toFeed[i].sample;
    let regionEnd = i;
    let regionBytes = first.size;
    while (regionEnd < toFeed.length - 1) {
      const current = toFeed[regionEnd].sample;
      const next = toFeed[regionEnd + 1].sample;
      if (next.offset === current.offset + current.size) {
        regionEnd += 1;
        regionBytes += next.size;
      } else {
        break;
      }
    }
    const members: Array<{ decodeIndex: number; size: number }> = [];
    for (let j = i; j <= regionEnd; j += 1) {
      members.push({
        decodeIndex: toFeed[j].sample.decodeIndex,
        size: toFeed[j].sample.size,
      });
    }
    regions.push({ offset: first.offset, length: regionBytes, members });
    i = regionEnd + 1;
  }
  return regions;
}

/**
 * Read every sample's encoded bytes (keyed by `decodeIndex`) via `readRange`,
 * coalescing contiguous samples into single reads. Pure aside from the injected
 * `readRange`, so it is unit-testable with a fake source. Mirrors
 * `Mp4BoxVideoBackend.readSampleDataByDecodeOrder`.
 */
export async function readSamplesByDecodeOrder(
  toFeed: FeedEntry[],
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
): Promise<Map<number, Uint8Array>> {
  const regions = planReadRegions(toFeed);
  const results = new Map<number, Uint8Array>();
  for (const region of regions) {
    const buffer = await readRange(region.offset, region.length);
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let bufferOffset = 0;
    for (const member of region.members) {
      results.set(
        member.decodeIndex,
        view.slice(bufferOffset, bufferOffset + member.size),
      );
      bufferOffset += member.size;
    }
  }
  return results;
}

/**
 * The first frame at/after `from` that is NOT yet covered (per `has`) — where
 * decode-ahead should start so it extends the runway rather than re-decoding.
 * Mirrors the skip loop in `Mp4BoxVideoBackend.decodeAhead`.
 */
export function nextUncached(
  from: number,
  length: number,
  has: (index: number) => boolean,
): number {
  let start = from;
  while (start < length && has(start)) start += 1;
  return start;
}

/**
 * Whether decode-ahead should run from `fromFrame`: there is runway left and the
 * frame `margin` steps ahead is not already covered. Mirrors the coverage gate in
 * `Mp4BoxVideoBackend.decodeAhead`.
 */
export function shouldDecodeAhead(
  fromFrame: number,
  length: number,
  margin: number,
  has: (index: number) => boolean,
): boolean {
  if (!length) return false;
  const probe = fromFrame + margin;
  if (probe >= length) return false;
  return !has(probe);
}
