// src/video/png-encode.ts
//
// Pure-JS PNG encoding of raw 8-bit pixels (zlib via `pako`), for browser and
// Node alike: no canvas, no native module. Unlike a canvas, which can only
// write RGBA, this keeps the pixels' own channel count, so a grayscale frame
// becomes a 1-channel (grayscale) PNG, as Python sleap-io writes when it embeds
// one.
import { deflate } from "pako";

/** PNG color type for each channel count: gray, gray+alpha, RGB, RGBA. */
const COLOR_TYPE: Record<number, number> = { 1: 0, 2: 4, 3: 2, 4: 6 };

/**
 * Encode row-major 8-bit pixels to a PNG byte stream.
 *
 * @param pixels - Interleaved pixels, `width * height * channels` bytes.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param channels - 1 (gray), 2 (gray+alpha), 3 (RGB) or 4 (RGBA).
 * @param compressLevel - zlib compression level 0–9 (default 6).
 */
export function encodePngPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  compressLevel: number | null = null,
): Uint8Array {
  const colorType = COLOR_TYPE[channels];
  if (colorType === undefined) {
    throw new Error(
      `Cannot PNG-encode a frame with ${channels} channels (expected 1–4).`,
    );
  }
  const stride = width * channels;
  if (pixels.length !== stride * height) {
    throw new Error(
      `Cannot PNG-encode a ${width}x${height} frame with ${channels} ` +
        `channel(s): expected ${stride * height} bytes, got ${pixels.length}.`,
    );
  }
  const level =
    compressLevel == null ? 6 : Math.min(9, Math.max(0, compressLevel));

  const raw = filterScanlines(pixels, width, height, channels);
  const compressed = deflate(raw, {
    level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  });

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const chunks = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ];

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * PNG scanlines with libpng's adaptive filtering (what Python sleap-io's
 * encoders, OpenCV and Pillow, use by default): each row gets the filter —
 * None, Sub, Up, Average or Paeth — whose output has the smallest sum of
 * absolute values (bytes read as signed), ties going to the earlier filter.
 * Smaller after deflate than unfiltered rows, and lossless either way.
 */
export function filterScanlines(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  const zero = new Uint8Array(stride);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : zero;
    const rowStart = y * (stride + 1);
    let bestFilter = 0;
    let bestSum = Number.POSITIVE_INFINITY;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (cur[i] - pred) & 0xff;
        trial[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestFilter = f;
        out.set(trial, rowStart + 1);
      }
    }
    out[rowStart] = bestFilter;
  }
  return out;
}

/** Build a length-prefixed, CRC32-suffixed PNG chunk. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ]);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

// CRC32 table (lazily built once).
let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
