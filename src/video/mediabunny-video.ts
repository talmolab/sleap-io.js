/**
 * MediaBunny Video Backend
 *
 * Alternative video decoding backend using MediaBunny. Supports additional
 * formats beyond MP4: WebM, Matroska, Ogg, MOV, MPEG-TS.
 *
 * Uses timestamp-based frame access internally, with a frame time index
 * built on initialization from packet metadata (no payload reads), sorted
 * into presentation order.
 */

import type { VideoBackend, VideoFrame, RangeSource } from "./backend.js";
import {
  Input,
  UrlSource,
  BlobSource,
  StreamSource,
  VideoSampleSink,
  EncodedPacketSink,
  ALL_FORMATS,
} from "mediabunny";
import { countHiddenLeadingSamples } from "./edit-list.js";
import {
  ensureNativeH264Probe,
  isLibavDecoderConfigured,
} from "./libav-h264-decoder.js";

/** MIME types of MediaBunny's ISOBMFF formats (MP4, MOV), which have edit lists. */
const ISOBMFF_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

/** True for MP4 / MOV (ISOBMFF) inputs, the only containers with edit lists. */
async function isIsobmff(input: Input): Promise<boolean> {
  try {
    return ISOBMFF_MIME_TYPES.has((await input.getFormat()).mimeType);
  } catch {
    return false;
  }
}

export interface MediaBunnyOptions {
  cacheSize?: number;
}

export class MediaBunnyVideoBackend implements VideoBackend {
  filename: string | string[];
  shape?: [number, number, number, number];
  fps?: number;
  dataset?: string | null = null;
  /** Frames an MP4/MOV edit list hides; see {@link VideoBackend.hiddenLeadingFrames}. */
  hiddenLeadingFrames = 0;

  private input: Input | null = null;
  private sink: VideoSampleSink | null = null;
  private _frameTimes: number[] = [];
  private cache: Map<number, ImageBitmap> = new Map();
  private cacheSize: number;
  private frameCount: number = 0;
  private decodingPromise: Promise<void> | null = null;

  constructor(filename: string | string[], options: MediaBunnyOptions = {}) {
    this.filename = filename;
    this.cacheSize = options.cacheSize ?? 120;
  }

  static async fromUrl(
    url: string,
    options?: MediaBunnyOptions & { headers?: Record<string, string> },
  ): Promise<MediaBunnyVideoBackend> {
    const backend = new MediaBunnyVideoBackend(url, options);
    // MediaBunny applies the custom headers to every byte fetch and overrides
    // `Range`/`signal` itself (so a user `Range` header cannot clobber it).
    const requestInit =
      options?.headers && Object.keys(options.headers).length > 0
        ? { headers: options.headers }
        : undefined;
    backend.input = new Input({
      source: new UrlSource(url, requestInit ? { requestInit } : undefined),
      formats: ALL_FORMATS,
    });
    await backend.initialize();
    return backend;
  }

  static async fromBlob(
    blob: Blob,
    filename: string,
    options?: MediaBunnyOptions,
  ): Promise<MediaBunnyVideoBackend> {
    const backend = new MediaBunnyVideoBackend(filename, options);
    backend.input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    await backend.initialize();
    return backend;
  }

  /**
   * Build from a lazy {@link RangeSource} — reads only the container index +
   * decoded frames' byte ranges via `readRange`, never the whole file. The
   * desktop counterpart of {@link fromBlob}, avoiding a multi-GB in-memory copy.
   * MediaBunny's {@link StreamSource} drives the reads; `read(start, end)` uses
   * an EXCLUSIVE end, so length is `end - start`.
   */
  static async fromRangeSource(
    rangeSource: RangeSource,
    filename: string,
    options?: MediaBunnyOptions,
  ): Promise<MediaBunnyVideoBackend> {
    const backend = new MediaBunnyVideoBackend(filename, options);
    backend.input = new Input({
      source: new StreamSource({
        getSize: () => rangeSource.size,
        read: (start, end) => rangeSource.readRange(start, end - start),
        // Local disk over IPC: page-aligned bidirectional prefetch fits better
        // than the aggressive network profile.
        prefetchProfile: "fileSystem",
      }),
      formats: ALL_FORMATS,
    });
    await backend.initialize();
    return backend;
  }

  private async initialize(): Promise<void> {
    if (!this.input) throw new Error("Input not set");

    // If the libav H.264 fallback decoder is configured, make sure the native-
    // capability probe has resolved before the sink lazily creates its decoder —
    // the custom decoder's sync `supports()` reads that cached result.
    if (isLibavDecoderConfigured()) {
      await ensureNativeH264Probe();
    }

    const videoTrack = await this.input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in file");
    }

    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;

    this.sink = new VideoSampleSink(videoTrack);

    const packetSink = new EncodedPacketSink(videoTrack);
    this._frameTimes = [];

    try {
      // metadataOnly: timestamps come from the container's sample table, so
      // skip reading every packet's payload (otherwise opening a video reads
      // the whole file just to build this index).
      for await (const packet of packetSink.packets(undefined, undefined, {
        metadataOnly: true,
      })) {
        this._frameTimes.push(packet.timestamp);
      }
      // Packets arrive in decode order, but frame index i means the i-th frame
      // shown. With B-frames those orders differ, so sort into presentation
      // order before the index is used to seek.
      this._frameTimes.sort((a, b) => a - b);
      // MP4/MOV edit list (#274): MediaBunny puts the edit's start at t=0, so
      // frames before it (kept only as decode references for a clip cut between
      // keyframes) have negative timestamps. ffmpeg / Python sleap-io never
      // show or count them, so leave them out of the index; the sink still
      // decodes them as references when seeking. Other containers keep
      // negative timestamps (ffmpeg shows those frames).
      if (await isIsobmff(this.input)) {
        this.hiddenLeadingFrames = countHiddenLeadingSamples(
          this._frameTimes,
          0,
        );
        if (this.hiddenLeadingFrames > 0) {
          this._frameTimes = this._frameTimes.slice(this.hiddenLeadingFrames);
        }
      }
    } catch (error) {
      this._frameTimes = [];
      this.sink = null;
      throw new Error(
        `Failed to build frame time index: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.frameCount = this._frameTimes.length;

    if (this.frameCount === 0) {
      throw new Error("No frames found in video track");
    }

    this.shape = [this.frameCount, height, width, 3];

    if (this._frameTimes.length >= 2) {
      const firstTimestamp = this._frameTimes[0];
      const lastTimestamp = this._frameTimes[this._frameTimes.length - 1];
      const totalDuration = lastTimestamp - firstTimestamp;

      if (totalDuration > 0) {
        this.fps = (this.frameCount - 1) / totalDuration;
      }
    }
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (frameIndex < 0 || frameIndex >= this.frameCount) {
      return null;
    }

    const cached = this.cache.get(frameIndex);
    if (cached) {
      this.cache.delete(frameIndex);
      this.cache.set(frameIndex, cached);
      return cached;
    }

    if (this.decodingPromise) {
      await this.decodingPromise;
      if (this.cache.has(frameIndex)) {
        return this.cache.get(frameIndex) ?? null;
      }
    }

    return this.decodeSingleFrame(frameIndex);
  }

  private async decodeSingleFrame(
    frameIndex: number,
  ): Promise<VideoFrame | null> {
    if (!this.sink) throw new Error("Backend not initialized");

    const timestamp = this._frameTimes[frameIndex];
    const sample = await this.sink.getSample(timestamp);
    if (!sample) {
      return null;
    }

    const videoFrame = sample.toVideoFrame();
    const bitmap = await createImageBitmap(videoFrame);
    videoFrame.close();

    this.cacheFrame(frameIndex, bitmap);
    return bitmap;
  }

  async prefetch(startIndex: number, endIndex: number): Promise<void> {
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(endIndex, this.frameCount - 1);

    if (startIndex > endIndex) return;

    const uncachedRanges: Array<[number, number]> = [];
    let rangeStart: number | null = null;

    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.cache.has(i)) {
        if (rangeStart === null) rangeStart = i;
      } else if (rangeStart !== null) {
        uncachedRanges.push([rangeStart, i - 1]);
        rangeStart = null;
      }
    }
    if (rangeStart !== null) {
      uncachedRanges.push([rangeStart, endIndex]);
    }

    for (const [start, end] of uncachedRanges) {
      await this.decodeRange(start, end);
    }
  }

  async getFrames(
    startIndex: number,
    endIndex: number,
  ): Promise<Map<number, ImageBitmap>> {
    await this.prefetch(startIndex, endIndex);

    const result = new Map<number, ImageBitmap>();
    for (let i = startIndex; i <= endIndex; i++) {
      const frame = this.cache.get(i);
      if (frame) {
        result.set(i, frame);
      }
    }
    return result;
  }

  private async decodeRange(
    startIndex: number,
    endIndex: number,
  ): Promise<void> {
    if (!this.sink) throw new Error("Backend not initialized");

    const sink = this.sink;

    this.decodingPromise = (async () => {
      try {
        const startTime = this._frameTimes[startIndex];
        const endTime = this._frameTimes[endIndex];

        const timestampToIndex = new Map<number, number>();
        for (let i = startIndex; i <= endIndex; i++) {
          timestampToIndex.set(this._frameTimes[i], i);
        }

        for await (const sample of sink.samples(startTime, endTime)) {
          let frameIndex = timestampToIndex.get(sample.timestamp);

          if (frameIndex === undefined) {
            let bestDiff = Infinity;
            for (const [ts, idx] of timestampToIndex) {
              const diff = Math.abs(ts - sample.timestamp);
              if (diff < bestDiff) {
                bestDiff = diff;
                frameIndex = idx;
              }
            }
          }

          if (frameIndex !== undefined && !this.cache.has(frameIndex)) {
            const videoFrame = sample.toVideoFrame();
            const bitmap = await createImageBitmap(videoFrame);
            videoFrame.close();
            this.cacheFrame(frameIndex, bitmap);
          }
        }
      } finally {
        this.decodingPromise = null;
      }
    })();

    return this.decodingPromise;
  }

  async getFrameTimes(): Promise<number[] | null> {
    return [...this._frameTimes];
  }

  get numFrames(): number {
    return this.frameCount;
  }

  close(): void {
    this.cache.forEach((bitmap) => {
      bitmap.close();
    });
    this.cache.clear();

    this.sink = null;
    this.input = null;
    this._frameTimes = [];
    this.frameCount = 0;
  }

  private cacheFrame(frameIndex: number, bitmap: ImageBitmap): void {
    if (this.cache.size >= this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.cache.get(oldestKey);
        evicted?.close();
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(frameIndex, bitmap);
  }
}
