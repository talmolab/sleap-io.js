/**
 * Worker half of the streaming NEW-embed path (embedding frames of a
 * continuous video, e.g. an mp4, into a pkg.slp written straight to disk).
 *
 * The main thread reads each frame (the decode itself may already run in the
 * mp4 decode worker) and hands it over, transferred where it can be: an
 * `ImageBitmap`, raw pixels, or already-encoded PNG (or, for a video stored
 * as JPEG, JPEG) bytes. These helpers turn that into the video's stored
 * format (PNG unless the entry chose JPEG) and append it to the open
 * destination file's
 * `video{i}/video` dataset row by row, so neither the UI thread nor the wasm
 * heap ever holds the whole embedded video. It writes Python sleap-io's
 * on-disk layout, as the main-thread `writeEmbeddedVideoData` (write.ts) does.
 *
 * Inlined into `H5_WORKER_CODE`, where `writeSourceVideoJsonWorker` comes
 * from. Kept as its own string so tests can evaluate it directly (with that
 * supplied) against h5wasm on Node. The dataset writer here is shared with the
 * worker's raw-copy `appendEmbeddedVideos`.
 *
 * No backticks or `${` in the code below: it sits inside a template literal.
 *
 * @module
 */
export const EMBED_ENCODE_WORKER_CODE = `
// --- streaming new-embed: PNG encode (KEEP IN LOCKSTEP with
// ../../video/png-encode.ts, which the main-thread embed path uses) ---
var PNG_COLOR_TYPE_ENC = { 1: 0, 2: 4, 3: 2, 4: 6 };
var CRC_TABLE_ENC = null;

function crc32Enc(bytes) {
  if (CRC_TABLE_ENC === null) {
    CRC_TABLE_ENC = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE_ENC[n] = c >>> 0;
    }
  }
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE_ENC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunkEnc(type, data) {
  var out = new Uint8Array(12 + data.length);
  var dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32Enc(out.subarray(4, 8 + data.length)));
  return out;
}

// A zlib stream of STORED (uncompressed) deflate blocks: a valid PNG IDAT
// where CompressionStream is unavailable. Bigger files, same pixels.
function zlibStoredEnc(raw) {
  var MAX = 65535;
  var blocks = Math.max(1, Math.ceil(raw.length / MAX));
  var out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  var o = 2;
  for (var b = 0; b < blocks; b++) {
    var start = b * MAX;
    var len = Math.min(MAX, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = (len >>> 8) & 0xff;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  var a = 1, s = 0;
  for (var i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    s = (s + a) % 65521;
  }
  new DataView(out.buffer).setUint32(o, ((s << 16) | a) >>> 0);
  return out;
}

async function zlibDeflateEnc(raw) {
  if (typeof CompressionStream === 'undefined') return zlibStoredEnc(raw);
  var stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Every row Sub-filtered, as OpenCV (KEEP IN LOCKSTEP with png-encode.ts's
// subFilterScanlines). Compression is CompressionStream's zlib, whose level
// can't be set (the main thread's pako encoder uses OpenCV's level 1 + RLE).
function subFilterScanlinesEnc(pixels, width, height, channels) {
  var stride = width * channels;
  var out = new Uint8Array((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    var o = y * (stride + 1);
    var r = y * stride;
    out[o] = 1;
    for (var c = 0; c < channels; c++) out[o + 1 + c] = pixels[r + c];
    for (var i = channels; i < stride; i++) {
      out[o + 1 + i] = (pixels[r + i] - pixels[r + i - channels]) & 0xff;
    }
  }
  return out;
}

// compressLevel (imageQuality for PNG): 0 stores the image data uncompressed;
// any other level uses CompressionStream's zlib, whose level can't be set.
async function encodePngEnc(pixels, width, height, channels, compressLevel) {
  var colorType = PNG_COLOR_TYPE_ENC[channels];
  if (colorType === undefined) {
    throw new Error('Cannot PNG-encode a frame with ' + channels + ' channels (expected 1-4).');
  }
  var stride = width * channels;
  if (pixels.length !== stride * height) {
    throw new Error(
      'Cannot PNG-encode a ' + width + 'x' + height + ' frame with ' + channels +
      ' channel(s): expected ' + stride * height + ' bytes, got ' + pixels.length + '.'
    );
  }
  var raw = subFilterScanlinesEnc(pixels, width, height, channels);
  var ihdr = new Uint8Array(13);
  var dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  var chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunkEnc('IHDR', ihdr),
    pngChunkEnc('IDAT', compressLevel === 0 ? zlibStoredEnc(raw) : await zlibDeflateEnc(raw)),
    pngChunkEnc('IEND', new Uint8Array(0))
  ];
  var total = 0;
  for (var c = 0; c < chunks.length; c++) total += chunks[c].length;
  var out = new Uint8Array(total);
  var off = 0;
  for (var d = 0; d < chunks.length; d++) { out.set(chunks[d], off); off += chunks[d].length; }
  return out;
}

// Pixels of a transferred frame, ready to encode. A bitmap (or a pixels payload
// flagged rgba, e.g. an ImageData) is RGBA by construction: its alpha is
// dropped, as video frames have none. collapseToGray keeps channel 0 only,
// exactly as grayscaleFrame (../../transform/frame.ts) - KEEP IN LOCKSTEP.
function framePixelsEnc(frame, collapseToGray) {
  var data, width, height, channels, rgba;
  if (frame.kind === 'bitmap') {
    var bmp = frame.bitmap;
    width = bmp.width;
    height = bmp.height;
    var ctx = new OffscreenCanvas(width, height).getContext('2d');
    if (!ctx) throw new Error('Failed to get a 2D context to read an embedded frame');
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close(); } catch (e) {}
    data = ctx.getImageData(0, 0, width, height).data;
    channels = 4;
    rgba = true;
  } else {
    data = frame.data;
    width = frame.width;
    height = frame.height;
    channels = frame.channels;
    rgba = !!frame.rgba;
  }
  var outCh = collapseToGray ? 1 : (rgba && channels === 4 ? 3 : channels);
  if (outCh === channels) {
    return { pixels: data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: width, height: height, channels: channels };
  }
  var n = width * height;
  var out = new Uint8Array(n * outCh);
  for (var p = 0, i = 0, o = 0; p < n; p++, i += channels, o += outCh) {
    for (var ch = 0; ch < outCh; ch++) out[o + ch] = data[i + ch];
  }
  return { pixels: out, width: width, height: height, channels: outCh };
}

// --- JPEG encode: a pure-JS baseline encoder, KEEP IN LOCKSTEP with
// ../../video/jpeg-encode.ts's encodeJpegPixels (a test checks both write the
// same bytes). Gray (1 channel, or 2 = gray + alpha): a 1-component JPEG, as
// Python sleap-io stores a grayscale frame. Colour (3, or 4 = RGBA): YCbCr
// 4:2:0. Alpha is ignored. Standard tables scaled as libjpeg. ---
var JPEG_DEFAULT_QUALITY_ENC = 95;
var JPEG_ZIGZAG_ENC = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63
];
var JPEG_LUMA_QUANT_ENC = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];
var JPEG_CHROMA_QUANT_ENC = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56,
  99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99
];
var JPEG_LUMA_DC_BITS_ENC = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
var JPEG_CHROMA_DC_BITS_ENC = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
var JPEG_DC_VALS_ENC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var JPEG_LUMA_AC_BITS_ENC = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
var JPEG_LUMA_AC_VALS_ENC = [
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
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa
];
var JPEG_CHROMA_AC_BITS_ENC = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
var JPEG_CHROMA_AC_VALS_ENC = [
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
  0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa
];
var JPEG_DCT_BASIS_ENC = null;

function jpegHuffmanTableEnc(bits, vals) {
  var codes = new Int32Array(256);
  var lengths = new Uint8Array(256);
  var code = 0;
  var k = 0;
  for (var len = 1; len <= 16; len++) {
    for (var i = 0; i < bits[len - 1]; i++) {
      codes[vals[k]] = code++;
      lengths[vals[k++]] = len;
    }
    code <<= 1;
  }
  return [codes, lengths];
}

function jpegScaledQuantEnc(base, quality) {
  var q = Math.min(100, Math.max(1, Math.trunc(quality)));
  var scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return Float64Array.from(base, function(v) {
    return Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100)));
  });
}

function encodeJpegEnc(pixels, width, height, channels, quality) {
  if (!(channels >= 1 && channels <= 4 && Number.isInteger(channels))) {
    throw new Error('Cannot JPEG-encode a frame with ' + channels + ' channels (expected 1-4).');
  }
  if (!(width >= 1 && height >= 1 && width <= 65535 && height <= 65535)) {
    throw new Error('Cannot JPEG-encode a ' + width + 'x' + height + ' frame.');
  }
  if (pixels.length !== width * height * channels) {
    throw new Error(
      'Cannot JPEG-encode a ' + width + 'x' + height + ' frame with ' + channels +
      ' channel(s): expected ' + width * height * channels + ' bytes, got ' + pixels.length + '.'
    );
  }
  if (JPEG_DCT_BASIS_ENC === null) {
    JPEG_DCT_BASIS_ENC = Float64Array.from({ length: 64 }, function(_, i) {
      var bu = i >> 3;
      var bx0 = i & 7;
      return 0.5 * (bu === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * bx0 + 1) * bu * Math.PI) / 16);
    });
  }
  var basis = JPEG_DCT_BASIS_ENC;
  var q = quality == null ? JPEG_DEFAULT_QUALITY_ENC : quality;
  var colour = channels >= 3;
  var quants = colour
    ? [jpegScaledQuantEnc(JPEG_LUMA_QUANT_ENC, q), jpegScaledQuantEnc(JPEG_CHROMA_QUANT_ENC, q)]
    : [jpegScaledQuantEnc(JPEG_LUMA_QUANT_ENC, q)];
  var dcTables = [jpegHuffmanTableEnc(JPEG_LUMA_DC_BITS_ENC, JPEG_DC_VALS_ENC)];
  var acTables = [jpegHuffmanTableEnc(JPEG_LUMA_AC_BITS_ENC, JPEG_LUMA_AC_VALS_ENC)];
  if (colour) {
    dcTables.push(jpegHuffmanTableEnc(JPEG_CHROMA_DC_BITS_ENC, JPEG_DC_VALS_ENC));
    acTables.push(jpegHuffmanTableEnc(JPEG_CHROMA_AC_BITS_ENC, JPEG_CHROMA_AC_VALS_ENC));
  }

  var mcu = colour ? 16 : 8;
  var pw = Math.ceil(width / mcu) * mcu;
  var ph = Math.ceil(height / mcu) * mcu;
  var lum = new Float64Array(pw * ph);
  var cw = pw >> 1;
  var cb = colour ? new Float64Array(cw * (ph >> 1)) : null;
  var cr = colour ? new Float64Array(cw * (ph >> 1)) : null;
  for (var y = 0; y < ph; y++) {
    var row = Math.min(y, height - 1) * width;
    for (var x = 0; x < pw; x++) {
      var i = (row + Math.min(x, width - 1)) * channels;
      if (!colour) {
        lum[y * pw + x] = pixels[i] - 128;
        continue;
      }
      var r = pixels[i];
      var g = pixels[i + 1];
      var b = pixels[i + 2];
      lum[y * pw + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      var c = (y >> 1) * cw + (x >> 1);
      cb[c] += 0.25 * (-0.168736 * r - 0.331264 * g + 0.5 * b);
      cr[c] += 0.25 * (0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }

  var out = new Uint8Array(1024 + ((width * height * channels) >> 2));
  var pos = 0;
  function byte(v) {
    if (pos === out.length) {
      var grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[pos++] = v;
  }
  function segment(marker, payload) {
    byte(0xff);
    byte(marker);
    byte((payload.length + 2) >> 8);
    byte((payload.length + 2) & 0xff);
    for (var p = 0; p < payload.length; p++) byte(payload[p]);
  }
  byte(0xff);
  byte(0xd8);
  segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  var dqt = [];
  for (var t0 = 0; t0 < quants.length; t0++) {
    dqt.push(t0);
    for (var z = 0; z < 64; z++) dqt.push(quants[t0][JPEG_ZIGZAG_ENC[z]]);
  }
  segment(0xdb, dqt);
  var sof = [8, height >> 8, height & 0xff, width >> 8, width & 0xff];
  sof.push(colour ? 3 : 1, 1, colour ? 0x22 : 0x11, 0);
  if (colour) sof.push(2, 0x11, 1, 3, 0x11, 1);
  segment(0xc0, sof);
  var dht = [0x00].concat(JPEG_LUMA_DC_BITS_ENC, JPEG_DC_VALS_ENC, [0x10], JPEG_LUMA_AC_BITS_ENC, JPEG_LUMA_AC_VALS_ENC);
  if (colour) {
    dht = dht.concat([0x01], JPEG_CHROMA_DC_BITS_ENC, JPEG_DC_VALS_ENC, [0x11], JPEG_CHROMA_AC_BITS_ENC, JPEG_CHROMA_AC_VALS_ENC);
  }
  segment(0xc4, dht);
  segment(0xda, colour ? [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0] : [1, 1, 0x00, 0, 63, 0]);

  var acc = 0;
  var nbits = 0;
  function put(code, len) {
    acc = (acc << len) | code;
    nbits += len;
    while (nbits >= 8) {
      var v = (acc >> (nbits - 8)) & 0xff;
      byte(v);
      if (v === 0xff) byte(0);
      nbits -= 8;
    }
    acc &= (1 << nbits) - 1;
  }
  var block = new Float64Array(64);
  var tmp = new Float64Array(64);
  var coef = new Int32Array(64);
  var prevDc = [0, 0, 0];
  function encodeBlock(plane, stride, bx, by, comp) {
    var t = comp === 0 ? 0 : 1;
    var quant = quants[t];
    var dcCodes = dcTables[t][0];
    var dcLengths = dcTables[t][1];
    var acCodes = acTables[t][0];
    var acLengths = acTables[t][1];
    for (var by2 = 0; by2 < 8; by2++) {
      for (var bx2 = 0; bx2 < 8; bx2++) {
        block[by2 * 8 + bx2] = plane[(by + by2) * stride + bx + bx2];
      }
    }
    for (var y1 = 0; y1 < 8; y1++) {
      for (var u = 0; u < 8; u++) {
        var s = 0;
        for (var x1 = 0; x1 < 8; x1++) s += basis[u * 8 + x1] * block[y1 * 8 + x1];
        tmp[y1 * 8 + u] = s;
      }
    }
    for (var u2 = 0; u2 < 8; u2++) {
      for (var v2 = 0; v2 < 8; v2++) {
        var s2 = 0;
        for (var y2 = 0; y2 < 8; y2++) s2 += basis[v2 * 8 + y2] * tmp[y2 * 8 + u2];
        coef[v2 * 8 + u2] = Math.round(s2 / quant[v2 * 8 + u2]);
      }
    }
    var value = coef[0] - prevDc[comp];
    prevDc[comp] = coef[0];
    var cat = 0;
    for (var a = Math.abs(value); a > 0; a >>= 1) cat++;
    put(dcCodes[cat], dcLengths[cat]);
    if (cat > 0) put(value < 0 ? value + (1 << cat) - 1 : value, cat);
    var run = 0;
    for (var k = 1; k < 64; k++) {
      value = coef[JPEG_ZIGZAG_ENC[k]];
      if (value === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        put(acCodes[0xf0], acLengths[0xf0]);
        run -= 16;
      }
      cat = 0;
      for (var a2 = Math.abs(value); a2 > 0; a2 >>= 1) cat++;
      var sym = (run << 4) | cat;
      put(acCodes[sym], acLengths[sym]);
      put(value < 0 ? value + (1 << cat) - 1 : value, cat);
      run = 0;
    }
    if (run > 0) put(acCodes[0], acLengths[0]);
  }
  for (var my = 0; my < ph; my += mcu) {
    for (var mx = 0; mx < pw; mx += mcu) {
      if (!colour) {
        encodeBlock(lum, pw, mx, my, 0);
        continue;
      }
      encodeBlock(lum, pw, mx, my, 0);
      encodeBlock(lum, pw, mx + 8, my, 0);
      encodeBlock(lum, pw, mx, my + 8, 0);
      encodeBlock(lum, pw, mx + 8, my + 8, 0);
      encodeBlock(cb, cw, mx >> 1, my >> 1, 1);
      encodeBlock(cr, cw, mx >> 1, my >> 1, 2);
    }
  }
  if (nbits > 0) put((1 << (8 - nbits)) - 1, 8 - nbits);
  byte(0xff);
  byte(0xd9);
  return out.slice(0, pos);
}

// The bytes to store for one transferred frame. Without a chosen format
// (entry.formatChosen), every frame is a PNG, as before the option existed;
// with one, encoded bytes the main thread passed on (already in the format)
// are stored as they are and pixels are encoded in the entry's format.
async function encodeFrameEnc(frame, collapseToGray, entry) {
  if (!entry || !entry.formatChosen) {
    if (frame.kind === 'png') return frame.bytes;
    var px0 = framePixelsEnc(frame, collapseToGray);
    return encodePngEnc(px0.pixels, px0.width, px0.height, px0.channels);
  }
  var format = entry.format;
  var quality = entry.quality == null ? null : entry.quality;
  if (frame.kind === 'png' || frame.kind === 'jpg') {
    if (frame.kind !== format) {
      throw new Error(
        'video' + entry.videoIndex + ' is stored as ' + format + ' but was handed ' +
        frame.kind + ' bytes; pass pixels to re-encode them.'
      );
    }
    return frame.bytes;
  }
  var px = framePixelsEnc(frame, collapseToGray);
  if (format === 'jpg') return encodeJpegEnc(px.pixels, px.width, px.height, px.channels, quality);
  return encodePngEnc(px.pixels, px.width, px.height, px.channels, quality);
}

// --- embedded video dataset writer, in Python sleap-io's layout (KEEP IN
// LOCKSTEP with write.ts's writeEmbeddedVideoData). Shared by the raw-copy
// appendEmbeddedVideos and the new-embed messages. '{group}/video' is a 2-D
// int8 dataset, one encoded image per row, zero-padded; its width grows to the
// widest image (chunked, since the widest isn't known until the last frame). ---

// KEEP IN LOCKSTEP with write.ts's paddedChunkWidth.
function paddedChunkWidthEnc(firstFrameBytes) {
  var width = 4096;
  while (width < firstFrameBytes / 8 && width < 262144) width *= 2;
  return width;
}

function beginPaddedVideoEnc(file, group, rows) {
  file.create_group(group);
  return { file: file, group: group, rows: rows, ds: null, width: 0, frameNumbers: [] };
}

function appendPaddedRowEnc(state, frameIdx, bytes) {
  if (!bytes || bytes.length === 0) {
    throw new Error(state.group + ': frame ' + frameIdx + ' has no image bytes');
  }
  var row = state.frameNumbers.length;
  if (row >= state.rows) {
    throw new Error(state.group + ': more frames than the ' + state.rows + ' planned');
  }
  if (!state.ds) {
    state.file.create_dataset({
      name: state.group + '/video',
      data: new Int8Array(0),
      shape: [state.rows, 0],
      maxshape: [state.rows, null],
      chunks: [1, paddedChunkWidthEnc(bytes.length)],
      dtype: '<b'
    });
    state.ds = state.file.get(state.group + '/video');
  }
  if (bytes.length > state.width) {
    state.width = bytes.length;
    state.ds.resize([state.rows, state.width]);
  }
  state.ds.write_slice(
    [[row, row + 1], [0, bytes.length]],
    new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  );
  state.frameNumbers.push(frameIdx);
}

// Attributes exactly as Python sleap-io (KEEP IN LOCKSTEP with write.ts's
// writeEmbeddedVideoAttrs): variable-length UTF-8 strings, int64 dimensions,
// float64 fps.
function writeEmbeddedVideoAttrsEnc(ds, format, channelOrder, attrs) {
  ds.create_attribute('format', format);
  ds.create_attribute('channel_order', channelOrder);
  if (!attrs) return;
  var keys = ['frames', 'height', 'width', 'channels'];
  for (var k = 0; k < keys.length; k++) {
    ds.create_attribute(keys[k], BigInt64Array.from([BigInt(attrs[keys[k]])]), [], '<q');
  }
  if (attrs.fps != null) ds.create_attribute('fps', attrs.fps, [], '<d');
}

// Finish a video: an empty one becomes Python's empty embedded video (a 1-D
// empty dataset); then attributes, frame_numbers (int64, or Python's empty
// float64) and the source_video lineage.
function finishPaddedVideoEnc(state, format, channelOrder, attrs, sourceVideoJson) {
  var file = state.file;
  if (!state.ds) {
    file.create_dataset({ name: state.group + '/video', data: new Int8Array(0), shape: [0], dtype: '<b' });
    state.ds = file.get(state.group + '/video');
  }
  writeEmbeddedVideoAttrsEnc(state.ds, format, channelOrder, attrs);
  var fns = state.frameNumbers;
  if (fns.length > 0) {
    file.create_dataset({
      name: state.group + '/frame_numbers',
      data: BigInt64Array.from(fns, function(f) { return BigInt(f); }),
      shape: [fns.length],
      dtype: '<q'
    });
  } else {
    file.create_dataset({ name: state.group + '/frame_numbers', data: new Float64Array(0), shape: [0], dtype: '<d' });
  }
  if (sourceVideoJson) writeSourceVideoJsonWorker(file, state.group, sourceVideoJson);
  file.flush();
  return { framesWritten: fns.length };
}

// --- streaming new-embed messages ---
function beginEncodedVideoEnc(file, entry) {
  var state = beginPaddedVideoEnc(file, 'video' + entry.videoIndex, entry.frameNumbers.length);
  state.entry = entry;
  return state;
}

function appendEncodedBytesEnc(state, frameIdx, bytes) {
  appendPaddedRowEnc(state, frameIdx, bytes);
}

function endEncodedVideoEnc(file, state) {
  var entry = state.entry;
  return finishPaddedVideoEnc(state, entry.format, entry.channelOrder, entry.videoAttrs, entry.sourceVideoJson);
}
`;
