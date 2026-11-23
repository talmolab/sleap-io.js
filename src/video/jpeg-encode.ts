// src/video/jpeg-encode.ts
//
// Pure-JS baseline JPEG encoding of raw 8-bit pixels for embedding frames:
// the same bytes in a browser, a worker and Node, with no canvas and no
// native module.
//
// It writes what OpenCV writes for Python sleap-io (libjpeg defaults): a
// grayscale frame as a 1-component JPEG, which reads back with one channel
// whatever the reader, and a colour frame as YCbCr with 4:2:0 chroma
// subsampling. The tables are the standard (Annex K) ones, scaled by quality
// as libjpeg's `jpeg_set_quality`, so a quality means what it means to
// libjpeg-based encoders (OpenCV, Pillow).
//
// The streaming writer's worker carries a copy of this encoder
// (embed-encode-worker.ts): KEEP IN LOCKSTEP. A test checks that both copies
// write the same bytes.

/** JPEG quality used when none is given: OpenCV's default, as Python sleap-io. */
export const DEFAULT_JPEG_QUALITY = 95;

/** Zigzag position -> natural (row-major) position in an 8x8 block. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

/** Annex K quantization tables, natural order: luminance, chrominance. */
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56,
  99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99,
];

/** Annex K Huffman tables: code counts per length 1-16, then the symbols. */
const LUMA_DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const CHROMA_DC_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const LUMA_AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const LUMA_AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
  0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42,
  0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
  0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7,
  0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const CHROMA_AC_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const CHROMA_AC_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
  0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1,
  0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24,
  0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66,
  0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
  0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
  0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
  0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4,
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

/** Canonical Huffman codes from code counts, as [codes, lengths] by symbol. */
function huffmanTable(
  bits: number[],
  vals: number[],
): [Int32Array, Uint8Array] {
  const codes = new Int32Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      codes[vals[k]] = code++;
      lengths[vals[k++]] = len;
    }
    code <<= 1;
  }
  return [codes, lengths];
}

/** libjpeg's quality scaling of a base table (baseline: 1-255; q 0 is 1). */
function scaledQuant(base: number[], quality: number): Float64Array {
  const q = Math.min(100, Math.max(1, Math.trunc(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return Float64Array.from(base, (v) =>
    Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))),
  );
}

/** cos((2x + 1) u pi / 16) * C(u) / 2, indexed [u * 8 + x]. */
const DCT_BASIS = Float64Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3;
  const x = i & 7;
  return (
    0.5 *
    (u === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  );
});

/**
 * Encode interleaved 8-bit pixels to a baseline JPEG: 1 channel (or 2, gray
 * + alpha) as a 1-component grayscale JPEG; 3 (RGB) or 4 (RGBA) as YCbCr
 * 4:2:0. Alpha is ignored: frames are opaque.
 *
 * @param pixels - `width * height * channels` bytes, row-major.
 * @param quality - 0-100 (default {@link DEFAULT_JPEG_QUALITY}), scaled as
 *   libjpeg (0 is treated as 1).
 */
export function encodeJpegPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  quality: number | null = null,
): Uint8Array {
  if (!(channels >= 1 && channels <= 4 && Number.isInteger(channels))) {
    throw new Error(
      `Cannot JPEG-encode a frame with ${channels} channels (expected 1-4).`,
    );
  }
  if (!(width >= 1 && height >= 1 && width <= 65535 && height <= 65535)) {
    throw new Error(`Cannot JPEG-encode a ${width}x${height} frame.`);
  }
  if (pixels.length !== width * height * channels) {
    throw new Error(
      `Cannot JPEG-encode a ${width}x${height} frame with ${channels} ` +
        `channel(s): expected ${width * height * channels} bytes, got ${pixels.length}.`,
    );
  }
  const q = quality ?? DEFAULT_JPEG_QUALITY;
  const colour = channels >= 3;
  const quants = colour
    ? [scaledQuant(LUMA_QUANT, q), scaledQuant(CHROMA_QUANT, q)]
    : [scaledQuant(LUMA_QUANT, q)];
  const dcTables = [huffmanTable(LUMA_DC_BITS, DC_VALS)];
  const acTables = [huffmanTable(LUMA_AC_BITS, LUMA_AC_VALS)];
  if (colour) {
    dcTables.push(huffmanTable(CHROMA_DC_BITS, DC_VALS));
    acTables.push(huffmanTable(CHROMA_AC_BITS, CHROMA_AC_VALS));
  }

  // Level-shifted planes padded to whole MCUs by repeating the last row and
  // column, as libjpeg: Y at full size; Cb, Cr as 2x2 averages (4:2:0).
  const mcu = colour ? 16 : 8;
  const pw = Math.ceil(width / mcu) * mcu;
  const ph = Math.ceil(height / mcu) * mcu;
  const lum = new Float64Array(pw * ph);
  const cw = pw >> 1;
  const cb = colour ? new Float64Array(cw * (ph >> 1)) : null;
  const cr = colour ? new Float64Array(cw * (ph >> 1)) : null;
  for (let y = 0; y < ph; y++) {
    const row = Math.min(y, height - 1) * width;
    for (let x = 0; x < pw; x++) {
      const i = (row + Math.min(x, width - 1)) * channels;
      if (!colour) {
        lum[y * pw + x] = pixels[i] - 128;
        continue;
      }
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      lum[y * pw + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      const c = (y >> 1) * cw + (x >> 1);
      cb![c] += 0.25 * (-0.168736 * r - 0.331264 * g + 0.5 * b);
      cr![c] += 0.25 * (0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }

  // Output, grown as needed.
  let out = new Uint8Array(1024 + ((width * height * channels) >> 2));
  let pos = 0;
  const byte = (b: number) => {
    if (pos === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[pos++] = b;
  };
  const segment = (marker: number, payload: number[]) => {
    byte(0xff);
    byte(marker);
    byte((payload.length + 2) >> 8);
    byte((payload.length + 2) & 0xff);
    for (const b of payload) byte(b);
  };
  byte(0xff);
  byte(0xd8); // SOI
  // APP0 JFIF 1.01, no density units, 1:1, no thumbnail.
  segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt: number[] = [];
  quants.forEach((table, t) => {
    dqt.push(t);
    for (const n of ZIGZAG) dqt.push(table[n]);
  });
  segment(0xdb, dqt);
  // SOF0: 8-bit; Y is component 1 (2x2 sampling when colour), Cb/Cr 2 and 3.
  const sof = [8, height >> 8, height & 0xff, width >> 8, width & 0xff];
  sof.push(colour ? 3 : 1, 1, colour ? 0x22 : 0x11, 0);
  if (colour) sof.push(2, 0x11, 1, 3, 0x11, 1);
  segment(0xc0, sof);
  const dht = [0x00, ...LUMA_DC_BITS, ...DC_VALS];
  dht.push(0x10, ...LUMA_AC_BITS, ...LUMA_AC_VALS);
  if (colour) {
    dht.push(0x01, ...CHROMA_DC_BITS, ...DC_VALS);
    dht.push(0x11, ...CHROMA_AC_BITS, ...CHROMA_AC_VALS);
  }
  segment(0xc4, dht);
  segment(
    0xda,
    colour ? [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0] : [1, 1, 0x00, 0, 63, 0],
  );

  // Entropy-coded data, with 0xFF byte stuffing.
  let acc = 0;
  let nbits = 0;
  const put = (code: number, len: number) => {
    acc = (acc << len) | code;
    nbits += len;
    while (nbits >= 8) {
      const b = (acc >> (nbits - 8)) & 0xff;
      byte(b);
      if (b === 0xff) byte(0);
      nbits -= 8;
    }
    acc &= (1 << nbits) - 1;
  };
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const coef = new Int32Array(64);
  const prevDc = [0, 0, 0];
  const encodeBlock = (
    plane: Float64Array,
    stride: number,
    bx: number,
    by: number,
    comp: number,
  ) => {
    const t = comp === 0 ? 0 : 1;
    const quant = quants[t];
    const [dcCodes, dcLengths] = dcTables[t];
    const [acCodes, acLengths] = acTables[t];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        block[y * 8 + x] = plane[(by + y) * stride + bx + x];
      }
    }
    // 2-D DCT-II as two 1-D passes: rows, then columns.
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++)
          s += DCT_BASIS[u * 8 + x] * block[y * 8 + x];
        tmp[y * 8 + u] = s;
      }
    }
    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += DCT_BASIS[v * 8 + y] * tmp[y * 8 + u];
        coef[v * 8 + u] = Math.round(s / quant[v * 8 + u]);
      }
    }
    // DC difference, then the AC run-lengths in zigzag order. A value is
    // written as its category's code, then its low bits (ones' complement
    // when negative).
    let value = coef[0] - prevDc[comp];
    prevDc[comp] = coef[0];
    let cat = 0;
    for (let a = Math.abs(value); a > 0; a >>= 1) cat++;
    put(dcCodes[cat], dcLengths[cat]);
    if (cat > 0) put(value < 0 ? value + (1 << cat) - 1 : value, cat);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      value = coef[ZIGZAG[k]];
      if (value === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        put(acCodes[0xf0], acLengths[0xf0]);
        run -= 16;
      }
      cat = 0;
      for (let a = Math.abs(value); a > 0; a >>= 1) cat++;
      const sym = (run << 4) | cat;
      put(acCodes[sym], acLengths[sym]);
      put(value < 0 ? value + (1 << cat) - 1 : value, cat);
      run = 0;
    }
    if (run > 0) put(acCodes[0], acLengths[0]); // EOB
  };
  for (let my = 0; my < ph; my += mcu) {
    for (let mx = 0; mx < pw; mx += mcu) {
      if (!colour) {
        encodeBlock(lum, pw, mx, my, 0);
        continue;
      }
      encodeBlock(lum, pw, mx, my, 0);
      encodeBlock(lum, pw, mx + 8, my, 0);
      encodeBlock(lum, pw, mx, my + 8, 0);
      encodeBlock(lum, pw, mx + 8, my + 8, 0);
      encodeBlock(cb!, cw, mx >> 1, my >> 1, 1);
      encodeBlock(cr!, cw, mx >> 1, my >> 1, 2);
    }
  }
  if (nbits > 0) put((1 << (8 - nbits)) - 1, 8 - nbits); // pad with 1-bits
  byte(0xff);
  byte(0xd9); // EOI
  return out.slice(0, pos);
}

/**
 * Encode 8-bit grayscale pixels (one byte per pixel) to a 1-component JPEG.
 * Shorthand for {@link encodeJpegPixels} with one channel.
 */
export function encodeGrayJpeg(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  quality: number = DEFAULT_JPEG_QUALITY,
): Uint8Array {
  return encodeJpegPixels(pixels, width, height, 1, quality);
}
