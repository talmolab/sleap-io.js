/**
 * Worker half of the streaming NEW-embed path (embedding frames of a
 * continuous video, e.g. an mp4, into a pkg.slp written straight to disk).
 *
 * The main thread reads each frame (the decode itself may already run in the
 * mp4 decode worker) and hands it over, transferred where it can be: an
 * `ImageBitmap`, raw pixels, or already-encoded PNG bytes. These helpers turn
 * that into a PNG and append it to the open destination file's
 * `video{i}/video` dataset in bounded windows, so neither the UI thread nor
 * the wasm heap ever holds the whole embedded video. It is the counterpart of
 * the raw-copy `appendEmbeddedVideos` in `h5-worker.ts`, and writes the same
 * on-disk layout as the main-thread `writeEmbeddedVideoData` (write.ts).
 *
 * Inlined into `H5_WORKER_CODE`, where `setStringAttrWorker`,
 * `writeSourceVideoJsonWorker`, `EMBED_WRITE_WINDOW_BYTES` and
 * `EMBED_VIDEO_CHUNK_BYTES` come from. Kept as its own string so tests can
 * evaluate it directly (with those four supplied) against h5wasm on Node.
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

async function encodePngEnc(pixels, width, height, channels) {
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
  var raw = new Uint8Array((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  var ihdr = new Uint8Array(13);
  var dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  var chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunkEnc('IHDR', ihdr),
    pngChunkEnc('IDAT', await zlibDeflateEnc(raw)),
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

// The bytes to store for one transferred frame.
async function encodeFrameEnc(frame, collapseToGray) {
  if (frame.kind === 'png') return frame.bytes;
  var px = framePixelsEnc(frame, collapseToGray);
  return encodePngEnc(px.pixels, px.width, px.height, px.channels);
}

// --- streaming new-embed: dataset writer (same layout as write.ts's
// writeEmbeddedVideoData and the raw-copy appendEmbeddedVideos) ---
function beginEncodedVideoEnc(file, entry) {
  var group = 'video' + entry.videoIndex;
  file.create_group(group);
  if (entry.sourceVideoJson) {
    writeSourceVideoJsonWorker(file, group, entry.sourceVideoJson);
  }
  file.create_dataset({
    name: group + '/video',
    data: new Uint8Array(0),
    shape: [0],
    maxshape: [null],
    chunks: [EMBED_VIDEO_CHUNK_BYTES],
    dtype: '<B'
  });
  return {
    entry: entry,
    group: group,
    vds: file.get(group + '/video'),
    sizes: [],
    frameNumbers: [],
    total: 0,
    win: [],
    winBytes: 0
  };
}

function flushEncodedEnc(state) {
  if (state.winBytes === 0) return;
  var buf = new Uint8Array(state.winBytes);
  var o = 0;
  for (var k = 0; k < state.win.length; k++) { buf.set(state.win[k], o); o += state.win[k].length; }
  state.vds.resize([state.total + state.winBytes]);
  state.vds.write_slice([[state.total, state.total + state.winBytes]], buf);
  state.total += state.winBytes;
  state.win = [];
  state.winBytes = 0;
}

function appendEncodedBytesEnc(state, frameIdx, bytes) {
  if (!bytes || bytes.length === 0) {
    throw new Error('embedding video' + state.entry.videoIndex + ': frame ' + frameIdx + ' encoded to no bytes');
  }
  state.win.push(bytes);
  state.winBytes += bytes.length;
  state.sizes.push(bytes.length);
  state.frameNumbers.push(frameIdx);
  if (state.winBytes >= EMBED_WRITE_WINDOW_BYTES) flushEncodedEnc(state);
}

function endEncodedVideoEnc(file, state) {
  flushEncodedEnc(state);
  var entry = state.entry;
  setStringAttrWorker(state.vds, 'format', entry.format);
  setStringAttrWorker(state.vds, 'channel_order', entry.channelOrder);
  if (entry.emptyAttrs) {
    // An empty embedded video keeps its source's shape and fps on the dataset,
    // as write.ts (and Python sleap-io's _create_empty_embedded_video).
    state.vds.create_attribute('frames', entry.emptyAttrs.frames);
    state.vds.create_attribute('height', entry.emptyAttrs.height);
    state.vds.create_attribute('width', entry.emptyAttrs.width);
    state.vds.create_attribute('channels', entry.emptyAttrs.channels);
    if (entry.emptyAttrs.fps != null) state.vds.create_attribute('fps', entry.emptyAttrs.fps);
  }
  file.create_dataset({
    name: state.group + '/frame_numbers',
    data: state.frameNumbers,
    shape: [state.frameNumbers.length],
    dtype: '<i4'
  });
  file.create_dataset({
    name: state.group + '/frame_sizes',
    data: state.sizes,
    shape: [state.sizes.length],
    dtype: '<i4'
  });
  file.flush();
  return { framesWritten: state.frameNumbers.length };
}
`;
