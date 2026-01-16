import { VideoBackend, VideoFrame } from "./backend.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
const hasWebCodecs = isBrowser && typeof window.VideoDecoder !== "undefined" && typeof window.EncodedVideoChunk !== "undefined";
const MP4BOX_CDN = "https://unpkg.com/mp4box@0.5.4/dist/mp4box.all.min.js";

async function loadMp4box(): Promise<any> {
  const globalMp4box = (globalThis as { MP4Box?: any }).MP4Box;
  if (globalMp4box) return globalMp4box;

  try {
    const module = await import("mp4box");
    return module.default ?? module;
  } catch {
    if (!isBrowser || typeof document === "undefined") {
      throw new Error("Failed to load mp4box");
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MP4BOX_CDN;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load mp4box"));
      document.head.appendChild(script);
    });
    const afterLoad = (globalThis as { MP4Box?: any }).MP4Box;
    if (afterLoad) return afterLoad;
    throw new Error("Failed to load mp4box");
  }
}

const DEFAULT_CACHE_SIZE = 120;
const DEFAULT_LOOKAHEAD = 60;
const PARSE_CHUNK_SIZE = 1024 * 1024;

type Sample = {
  offset: number;
  size: number;
  timestamp: number;
  duration: number;
  isKeyframe: boolean;
  cts: number;
  decodeIndex: number;
};

export class Mp4BoxVideoBackend implements VideoBackend {
  filename: string;
  shape?: [number, number, number, number];
  fps?: number;
  dataset?: string | null;

  private ready: Promise<void>;
  private mp4box: any;
  private mp4boxFile: any;
  private videoTrack: any;
  private samples: Sample[];
  private keyframeIndices: number[];
  private cache: Map<number, ImageBitmap>;
  private cacheSize: number;
  private lookahead: number;
  private decoder: VideoDecoder | null;
  private config: VideoDecoderConfig | null;
  private fileSize: number;
  private supportsRangeRequests: boolean;
  private fileBlob: Blob | null;
  private isDecoding: boolean;
  private pendingFrame: number | null;

  constructor(filename: string, options?: { cacheSize?: number; lookahead?: number }) {
    if (!hasWebCodecs) {
      throw new Error("Mp4BoxVideoBackend requires WebCodecs support.");
    }
    if (!isBrowser) {
      throw new Error("Mp4BoxVideoBackend requires a browser environment.");
    }
    this.filename = filename;
    this.dataset = null;
    this.samples = [];
    this.keyframeIndices = [];
    this.cache = new Map();
    this.cacheSize = options?.cacheSize ?? DEFAULT_CACHE_SIZE;
    this.lookahead = options?.lookahead ?? DEFAULT_LOOKAHEAD;
    this.decoder = null;
    this.config = null;
    this.fileSize = 0;
    this.supportsRangeRequests = false;
    this.fileBlob = null;
    this.isDecoding = false;
    this.pendingFrame = null;
    this.ready = this.init();
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    await this.ready;
    if (frameIndex < 0 || frameIndex >= this.samples.length) return null;

    if (this.cache.has(frameIndex)) {
      const bitmap = this.cache.get(frameIndex) ?? null;
      if (bitmap) {
        this.cache.delete(frameIndex);
        this.cache.set(frameIndex, bitmap);
      }
      return bitmap;
    }

    if (this.isDecoding) {
      this.pendingFrame = frameIndex;
      await new Promise((resolve) => {
        const check = () => (this.isDecoding ? setTimeout(check, 10) : resolve(null));
        check();
      });
      if (this.cache.has(frameIndex)) {
        return this.cache.get(frameIndex) ?? null;
      }
      if (this.pendingFrame !== null && this.pendingFrame !== frameIndex) {
        return null;
      }
    }

    const keyframe = this.findKeyframeBefore(frameIndex);
    const end = Math.min(frameIndex + this.lookahead, this.samples.length - 1);
    await this.decodeRange(keyframe, end, frameIndex);

    return this.cache.get(frameIndex) ?? null;
  }

  async getFrameTimes(): Promise<number[] | null> {
    await this.ready;
    return this.samples.map((sample) => sample.timestamp / 1e6);
  }

  close(): void {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // ignore
      }
    }
    this.decoder = null;
    this.cache.forEach((bitmap) => bitmap.close());
    this.cache.clear();
    this.fileBlob = null;
  }

  private async init(): Promise<void> {
    await this.openSource();

    this.mp4box = await loadMp4box();
    this.mp4boxFile = this.mp4box.createFile();
    const ready = new Promise<any>((resolve, reject) => {
      this.mp4boxFile.onError = reject;
      this.mp4boxFile.onReady = resolve;
    });

    let offset = 0;
    let resolved = false;
    ready.then(() => {
      resolved = true;
    });

    while (offset < this.fileSize && !resolved) {
      const buffer = await this.readChunk(offset, PARSE_CHUNK_SIZE);
      (buffer as any).fileStart = offset;
      const next = this.mp4boxFile.appendBuffer(buffer as any);
      offset = next === undefined ? offset + buffer.byteLength : next;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const info = await ready;
    if (!info.videoTracks.length) throw new Error("No video tracks found");

    this.videoTrack = info.videoTracks[0];
    const trak = this.mp4boxFile.getTrackById(this.videoTrack.id);
    const description = this.getCodecDescription(trak);
    const codec = this.videoTrack.codec.startsWith("vp08") ? "vp8" : this.videoTrack.codec;
    this.config = {
      codec,
      codedWidth: this.videoTrack.video.width,
      codedHeight: this.videoTrack.video.height,
      description,
    };

    const support = await VideoDecoder.isConfigSupported(this.config);
    if (!support.supported) {
      throw new Error(`Codec ${codec} not supported`);
    }

    this.extractSamples();

    const duration = this.videoTrack.duration / this.videoTrack.timescale;
    this.fps = duration ? this.samples.length / duration : undefined;
    const frameCount = this.samples.length;
    const height = this.videoTrack.video.height;
    const width = this.videoTrack.video.width;
    this.shape = [frameCount, height, width, 3];
  }

  private async openSource(): Promise<void> {
    if (typeof this.filename !== "string") {
      throw new Error("Mp4BoxVideoBackend requires a single filename string.");
    }

    const response = await fetch(this.filename, { method: "HEAD" });
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);

    const size = response.headers.get("Content-Length");
    this.fileSize = size ? Number.parseInt(size, 10) : 0;

    if (this.fileSize > 0) {
      try {
        const rangeTest = await fetch(this.filename, { method: "GET", headers: { Range: "bytes=0-0" } });
        this.supportsRangeRequests = rangeTest.status === 206;
      } catch {
        this.supportsRangeRequests = false;
      }
    }

    if (!this.supportsRangeRequests || !this.fileSize) {
      const full = await fetch(this.filename);
      const blob = await full.blob();
      this.fileBlob = blob;
      this.fileSize = blob.size;
    }
  }

  private async readChunk(offset: number, size: number): Promise<ArrayBuffer> {
    const end = Math.min(offset + size, this.fileSize);
    if (this.supportsRangeRequests) {
      const response = await fetch(this.filename, { headers: { Range: `bytes=${offset}-${end - 1}` } });
      return await response.arrayBuffer();
    }
    if (this.fileBlob) {
      return await this.fileBlob.slice(offset, end).arrayBuffer();
    }
    throw new Error("No video source available");
  }

  private extractSamples(): void {
    const info = this.mp4boxFile.getTrackSamplesInfo(this.videoTrack.id);
    if (!info?.length) throw new Error("No samples");

    const ts = this.videoTrack.timescale;
    const samples = info.map((sample: any, index: number) => ({
      offset: sample.offset,
      size: sample.size,
      timestamp: (sample.cts * 1e6) / ts,
      duration: (sample.duration * 1e6) / ts,
      isKeyframe: sample.is_sync,
      cts: sample.cts,
      decodeIndex: index,
    }));

    this.samples = samples.sort((a: Sample, b: Sample) => {
      if (a.cts === b.cts) return a.decodeIndex - b.decodeIndex;
      return a.cts - b.cts;
    });

    this.keyframeIndices = [];
    this.samples.forEach((sample, index) => {
      if (sample.isKeyframe) this.keyframeIndices.push(index);
    });
  }

  private findKeyframeBefore(frameIndex: number): number {
    let result = 0;
    for (const keyframe of this.keyframeIndices) {
      if (keyframe <= frameIndex) result = keyframe;
      else break;
    }
    return result;
  }

  private getCodecDescription(trak: any): Uint8Array | undefined {
    const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
    const dataStream = (globalThis as { DataStream?: any }).DataStream ?? this.mp4box?.DataStream;
    if (!dataStream) return undefined;

    for (const entry of entries) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (!box) continue;
      const stream = new dataStream(undefined, 0, dataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
    return undefined;
  }

  private async readSampleDataByDecodeOrder(samplesToFeed: Array<{ pi: number; sample: Sample }>): Promise<Map<number, Uint8Array>> {
    const results = new Map<number, Uint8Array>();
    let i = 0;

    while (i < samplesToFeed.length) {
      const first = samplesToFeed[i];
      let regionEnd = i;
      let regionBytes = first.sample.size;

      while (regionEnd < samplesToFeed.length - 1) {
        const current = samplesToFeed[regionEnd];
        const next = samplesToFeed[regionEnd + 1];
        if (next.sample.offset === current.sample.offset + current.sample.size) {
          regionEnd += 1;
          regionBytes += next.sample.size;
        } else {
          break;
        }
      }

      const buffer = await this.readChunk(first.sample.offset, regionBytes);
      const bufferView = new Uint8Array(buffer);
      let bufferOffset = 0;

      for (let j = i; j <= regionEnd; j += 1) {
        const { sample } = samplesToFeed[j];
        results.set(sample.decodeIndex, bufferView.slice(bufferOffset, bufferOffset + sample.size));
        bufferOffset += sample.size;
      }

      i = regionEnd + 1;
    }

    return results;
  }

  private async decodeRange(start: number, end: number, target: number): Promise<void> {
    if (!this.config) throw new Error("Decoder not configured");
    this.isDecoding = true;

    try {
      if (this.decoder) {
        try {
          this.decoder.close();
        } catch {
          // ignore
        }
      }

      let minDecodeIndex = Infinity;
      let maxDecodeIndex = -Infinity;
      for (let i = start; i <= end; i += 1) {
        minDecodeIndex = Math.min(minDecodeIndex, this.samples[i].decodeIndex);
        maxDecodeIndex = Math.max(maxDecodeIndex, this.samples[i].decodeIndex);
      }

      const toFeed: Array<{ pi: number; sample: Sample }> = [];
      for (let i = 0; i < this.samples.length; i += 1) {
        const sample = this.samples[i];
        if (sample.decodeIndex >= minDecodeIndex && sample.decodeIndex <= maxDecodeIndex) {
          toFeed.push({ pi: i, sample });
        }
      }
      toFeed.sort((a, b) => a.sample.decodeIndex - b.sample.decodeIndex);

      const dataMap = await this.readSampleDataByDecodeOrder(toFeed);
      const timestampMap = new Map<number, number>();
      for (const { pi, sample } of toFeed) {
        timestampMap.set(Math.round(sample.timestamp), pi);
      }

      const halfCache = Math.floor(this.cacheSize / 2);
      const cacheStart = Math.max(start, target - halfCache);
      const cacheEnd = Math.min(end, target + halfCache);

      let decodedCount = 0;
      let resolveComplete: () => void;
      let rejectComplete: (error: Error) => void;
      const completionPromise = new Promise<void>((resolve, reject) => {
        resolveComplete = resolve;
        rejectComplete = reject;
      });

      this.decoder = new VideoDecoder({
        output: (frame) => {
          const roundedTimestamp = Math.round(frame.timestamp);
          let frameIndex = timestampMap.get(roundedTimestamp);
          if (frameIndex === undefined) {
            let bestDiff = Infinity;
            for (const [ts, idx] of timestampMap) {
              const diff = Math.abs(ts - frame.timestamp);
              if (diff < bestDiff) {
                bestDiff = diff;
                frameIndex = idx;
              }
            }
          }

          const handleClose = () => {
            frame.close();
            decodedCount += 1;
            if (decodedCount >= toFeed.length) resolveComplete();
          };

          if (frameIndex !== undefined && frameIndex >= cacheStart && frameIndex <= cacheEnd) {
            createImageBitmap(frame)
              .then((bitmap) => {
                this.addToCache(frameIndex as number, bitmap);
                handleClose();
              })
              .catch(handleClose);
          } else {
            handleClose();
          }
        },
        error: (error) => {
          if ((error as DOMException).name === "AbortError") {
            resolveComplete();
          } else {
            rejectComplete(error as Error);
          }
        },
      });

      this.decoder.configure(this.config);

      const BATCH_SIZE = 15;
      for (let i = 0; i < toFeed.length; i += BATCH_SIZE) {
        const batch = toFeed.slice(i, i + BATCH_SIZE);
        for (const { sample } of batch) {
          const data = dataMap.get(sample.decodeIndex);
          if (!data) continue;
          this.decoder.decode(
            new EncodedVideoChunk({
              type: sample.isKeyframe ? "key" : "delta",
              timestamp: sample.timestamp,
              duration: sample.duration,
              data,
            })
          );
        }
        if (i + BATCH_SIZE < toFeed.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      await this.decoder.flush();
      await completionPromise;
    } finally {
      this.isDecoding = false;
    }
  }

  private addToCache(frameIndex: number, bitmap: ImageBitmap): void {
    if (this.cache.size >= this.cacheSize) {
      const first = this.cache.keys().next();
      if (!first.done) {
        const evicted = this.cache.get(first.value);
        if (evicted) evicted.close();
        this.cache.delete(first.value);
      }
    }
    this.cache.set(frameIndex, bitmap);
  }
}
