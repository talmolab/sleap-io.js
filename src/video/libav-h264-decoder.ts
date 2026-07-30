/**
 * Software H.264 decoder for mediabunny, backed by a libav.js (FFmpeg) WASM build.
 *
 * Why: on the Linux desktop build (Tauri → WebKitGTK) many machines cannot decode
 * H.264 via native WebCodecs (the GStreamer H.264 plugin is omitted for patent
 * reasons), so MP4 videos render as blank frames. This registers a mediabunny
 * `CustomVideoDecoder` that decodes H.264 entirely in WASM as a *fallback*.
 *
 * ── Zero-regression gate ──────────────────────────────────────────────────────
 * mediabunny uses a registered custom decoder UNCONDITIONALLY whenever its static
 * `supports()` returns true — it never falls back to native. So `supports()` gates
 * on a cached, async native-capability probe (`VideoDecoder.isConfigSupported`):
 * it returns true ONLY when native H.264 decode is unavailable. On macOS, Windows,
 * and Linux-with-codec, native works → `supports()` is false → native is used →
 * no regression. The probe is capability-based, not OS-based (some Linux boxes have
 * the codec; some browsers lack it).
 *
 * ── WASM delivery ─────────────────────────────────────────────────────────────
 * This module ships no WASM. The embedding app vendors the libav.js build and
 * points `configureLibavDecoder({ wasmBaseUrl })` at it; the decoder loads the
 * loader `.mjs` from that base URL at runtime. Keeps an H.264 decoder off npm and
 * out of everyone's bundle — it loads only when actually needed.
 *
 * The decode path (extradata init, AVCC→decode, PTS, B-frame reorder, I420 output)
 * was validated byte-exact vs native WebCodecs. See docs/plans for the spike.
 */
import {
  CustomVideoDecoder,
  type EncodedPacket,
  registerDecoder,
  VideoSample,
} from "mediabunny";
import { colorSpaceFromSps } from "./h264-colorspace.js";

// ── Configuration seam (set by the app) ──────────────────────────────────────

export interface LibavDecoderConfig {
  /** Base URL under which the libav.js loader + wasm files are served. */
  wasmBaseUrl: string;
  /** Loader entry filename (default: the decoder-h264 variant loader). */
  loaderFileName?: string;
}

let decoderConfig: Required<LibavDecoderConfig> | null = null;

/** Configure where the libav.js WASM decoder is loaded from. Call before opening video. */
export function configureLibavDecoder(config: LibavDecoderConfig): void {
  decoderConfig = {
    wasmBaseUrl: config.wasmBaseUrl.replace(/\/$/, ""),
    loaderFileName: config.loaderFileName ?? "libav-6.9.8.1-decoder-h264.mjs",
  };
}

/** True once {@link configureLibavDecoder} has been called. */
export function isLibavDecoderConfigured(): boolean {
  return decoderConfig !== null;
}

// ── Native-capability probe (cached) ─────────────────────────────────────────

let nativeProbe: Promise<void> | null = null;
let nativeCanDecodeH264: boolean | null = null;
let nativeOverride: boolean | null | undefined;

/**
 * Test/dev override for the native-H.264 capability the gate sees. Pass `false`
 * to force the software fallback even on a machine that CAN decode natively
 * (useful for exercising the decoder end-to-end); `undefined` clears it.
 */
export function overrideNativeH264Decodable(
  value: boolean | null | undefined,
): void {
  nativeOverride = value;
}

/** The capability the gate/routing actually use — override if set, else probe. */
function effectiveNativeH264(): boolean | null {
  return nativeOverride !== undefined ? nativeOverride : nativeCanDecodeH264;
}

/**
 * Resolve (once) whether this environment can decode H.264 via native WebCodecs.
 * Must complete before the first decode so the sync `supports()` reads a ready
 * value — {@link MediaBunnyVideoBackend} awaits this in `initialize()`. Returns
 * the effective capability (honoring {@link overrideNativeH264Decodable}).
 */
export async function ensureNativeH264Probe(): Promise<boolean> {
  if (nativeProbe === null) {
    nativeProbe = (async () => {
      if (typeof VideoDecoder === "undefined") {
        nativeCanDecodeH264 = false;
        return;
      }
      // Representative H.264 configs: High@4.0, Main@3.0, Baseline@3.0.
      const codecs = ["avc1.640028", "avc1.4D401E", "avc1.42E01E"];
      for (const codec of codecs) {
        try {
          const support = await VideoDecoder.isConfigSupported({ codec });
          if (support?.supported) {
            nativeCanDecodeH264 = true;
            return;
          }
        } catch {
          /* try next */
        }
      }
      nativeCanDecodeH264 = false;
    })();
  }
  await nativeProbe;
  return effectiveNativeH264() === true;
}

/**
 * Synchronous view of the effective capability: `true`/`false` once resolved (or
 * overridden), `null` before. Used by the routing layer to decide MP4 →
 * MediaBunny fallback.
 */
export function nativeH264DecodableSync(): boolean | null {
  return effectiveNativeH264();
}

/**
 * Pure gate decision (exported for testing): use the libav software decoder only
 * for H.264 (`"avc"`), only when the app configured it, and only when native
 * decode is known-unavailable. A `null` probe (not yet resolved) → `false`, so we
 * never override native before we know it can't decode.
 */
export function shouldUseLibavH264(
  codec: string,
  configured: boolean,
  nativeCanDecode: boolean | null,
): boolean {
  return codec === "avc" && configured && nativeCanDecode === false;
}

// ── libav.js loader (from the injected base URL) ──────────────────────────────

interface LibAVFactory {
  LibAV(opts?: {
    noworker?: boolean;
    nothreads?: boolean;
    yesthreads?: boolean;
    base?: string;
  }): Promise<LibAVInstance>;
  base?: string;
}
// The libav.js surface is large and untyped here; we touch only a few members.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LibAVInstance = any;

let libavPromise: Promise<LibAVInstance> | null = null;
async function getLibAV(): Promise<LibAVInstance> {
  if (!decoderConfig) {
    throw new Error(
      "libav H.264 decoder used before configureLibavDecoder() was called",
    );
  }
  if (!libavPromise) {
    const { wasmBaseUrl, loaderFileName } = decoderConfig;
    libavPromise = (async () => {
      const url = `${wasmBaseUrl}/${loaderFileName}`;
      // Runtime-computed URL so bundlers don't try to resolve it statically.
      const mod = (await import(
        /* @vite-ignore */ /* webpackIgnore: true */ url
      )) as {
        default: LibAVFactory;
      };
      const factory = mod.default;
      factory.base = wasmBaseUrl;
      // Single-thread only for now — the threaded (SAB) variant is a follow-up
      // and would require vendoring the `.thr` wasm too.
      return factory.LibAV({ noworker: true, nothreads: true });
    })();
  }
  return libavPromise;
}

// ── The decoder ───────────────────────────────────────────────────────────────

const AV_CODEC_ID_H264 = 27;
const PTS_TB = 1_000_000; // microseconds
const START_CODE = new Uint8Array([0, 0, 0, 1]);

interface LibavFrame {
  data: Uint8Array;
  width: number;
  height: number;
  format: number;
  pts?: number;
  ptshi?: number;
  sample_aspect_ratio?: [number, number];
}

export class LibavH264Decoder extends CustomVideoDecoder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private libav: any = null;
  private c = -1;
  private pkt = -1;
  private frame = -1;
  private nalLen = 4;
  private paramSets: Uint8Array = new Uint8Array(0);
  private colorSpace: VideoColorSpaceInit | undefined;

  static supports(codec: string, _config: VideoDecoderConfig): boolean {
    return shouldUseLibavH264(
      codec,
      decoderConfig !== null,
      effectiveNativeH264(),
    );
  }

  async init(): Promise<void> {
    this.libav = await getLibAV();
    const desc = this.config.description
      ? toU8(this.config.description)
      : undefined;
    if (desc) {
      this.parseAvcC(desc);
      this.colorSpace = colorSpaceFromSps(this.spsNal(desc), this.config);
    }
    const byName = await this.libav.avcodec_find_decoder_by_name("h264");
    [, this.c, this.pkt, this.frame] = await this.libav.ff_init_decoder(
      byName ? "h264" : AV_CODEC_ID_H264,
    );
  }

  async decode(packet: EncodedPacket): Promise<void> {
    const isKey = packet.type === "key";
    const annexb = this.avccToAnnexB(toU8(packet.data), isKey);
    const pts = Math.round(packet.timestamp * PTS_TB);
    const frames: LibavFrame[] = await this.libav.ff_decode_multi(
      this.c,
      this.pkt,
      this.frame,
      [
        {
          data: annexb,
          pts,
          ptshi: 0,
          dts: pts,
          dtshi: 0,
          stream_index: 0,
          flags: isKey ? 1 : 0,
        },
      ],
      { fin: false, copyoutFrame: "video_packed" },
    );
    for (const f of frames) this.emit(f);
  }

  async flush(): Promise<void> {
    if (!this.libav || this.c < 0) return;
    const frames: LibavFrame[] = await this.libav.ff_decode_multi(
      this.c,
      this.pkt,
      this.frame,
      [],
      { fin: true, copyoutFrame: "video_packed" },
    );
    for (const f of frames) this.emit(f);
  }

  async close(): Promise<void> {
    if (this.libav && this.c >= 0) {
      try {
        await this.libav.ff_free_decoder(this.c, this.pkt, this.frame);
      } catch {
        /* ignore */
      }
    }
    this.c = this.pkt = this.frame = -1;
  }

  private emit(f: LibavFrame): void {
    const width = f.width;
    const height = f.height;
    const ptsMicros = f.pts ?? 0;

    let displayWidth = width;
    let displayHeight = height;
    const sar = f.sample_aspect_ratio;
    if (sar && sar[0] > 0 && sar[1] > 0 && sar[0] !== sar[1]) {
      if (sar[0] > sar[1]) displayWidth = Math.round((width * sar[0]) / sar[1]);
      else displayHeight = Math.round((height * sar[1]) / sar[0]);
    }

    const vf = new VideoFrame(f.data as BufferSource, {
      format: "I420",
      codedWidth: width,
      codedHeight: height,
      timestamp: ptsMicros,
      displayWidth,
      displayHeight,
      colorSpace: this.colorSpace,
    });
    this.onSample(new VideoSample(vf, { timestamp: ptsMicros / PTS_TB }));
  }

  /** Extract the first SPS NAL (Annex-B, without start code) from the avcC. */
  private spsNal(d: Uint8Array): Uint8Array | null {
    // d[5] low 5 bits = numSPS; first SPS begins at offset 8 (after its length).
    if (d.length < 8) return null;
    const numSps = d[5] & 0x1f;
    if (numSps < 1) return null;
    const len = (d[6] << 8) | d[7];
    if (8 + len > d.length) return null;
    return d.subarray(8, 8 + len);
  }

  private parseAvcC(d: Uint8Array): void {
    this.nalLen = (d[4] & 0x03) + 1;
    const parts: Uint8Array[] = [];
    let off = 5;
    const numSps = d[off++] & 0x1f;
    for (let i = 0; i < numSps; i++) {
      const len = (d[off] << 8) | d[off + 1];
      off += 2;
      parts.push(START_CODE, d.subarray(off, off + len));
      off += len;
    }
    const numPps = d[off++];
    for (let i = 0; i < numPps; i++) {
      const len = (d[off] << 8) | d[off + 1];
      off += 2;
      parts.push(START_CODE, d.subarray(off, off + len));
      off += len;
    }
    this.paramSets = concatBytes(parts);
  }

  private avccToAnnexB(data: Uint8Array, includeParams: boolean): Uint8Array {
    const parts: Uint8Array[] = [];
    if (includeParams && this.paramSets.length) parts.push(this.paramSets);
    let off = 0;
    while (off + this.nalLen <= data.length) {
      let len = 0;
      for (let i = 0; i < this.nalLen; i++) len = (len << 8) | data[off + i];
      off += this.nalLen;
      if (len <= 0 || off + len > data.length) break;
      parts.push(START_CODE, data.subarray(off, off + len));
      off += len;
    }
    return concatBytes(parts);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

let registered = false;

/**
 * Register the libav H.264 fallback decoder with mediabunny (idempotent) and kick
 * off the native-capability probe. No-op decode impact on machines with native
 * H.264 (see the `supports()` gate). Call after {@link configureLibavDecoder}.
 */
export async function registerLibavH264Decoder(): Promise<void> {
  // Synchronous guard (no await between check and set) so concurrent callers —
  // e.g. React StrictMode double-invoking the effect — register exactly once.
  if (!registered) {
    registered = true;
    registerDecoder(LibavH264Decoder);
  }
  await ensureNativeH264Probe();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toU8(buf: AllowSharedBufferSource): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array((buf as ArrayBufferView).buffer);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
