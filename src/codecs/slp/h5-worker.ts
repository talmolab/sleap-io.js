/**
 * Web Worker for streaming HDF5 file access via HTTP range requests.
 *
 * This worker runs h5wasm and uses Emscripten's createLazyFile which requires
 * synchronous XHR. Sync XHR is blocked in the main browser thread but allowed
 * in Web Workers, enabling efficient streaming of large HDF5 files.
 *
 * @module
 */

/**
 * Worker code as a string for inline blob creation.
 * This allows the worker to be bundled with the library without requiring
 * separate file hosting.
 */
export const H5_WORKER_CODE = `
// h5wasm streaming worker
// Handles all HDF5 operations in a Web Worker to avoid main thread blocking
// Supports: URL streaming (range requests), local files (WORKERFS), and ArrayBuffers

let h5wasmModule = null;
let FS = null;
let currentFile = null;
let mountPath = null;

// Inlined subset of ../../io/remote.ts (the worker runs in an isolated context
// via importScripts and cannot import the module). Keep in lockstep with
// RETRYABLE_STATUSES / withRetries / identityHeaders there.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// Force Accept-Encoding: identity (drop any user-supplied value, any case) so a
// gzip transfer-encoding cannot corrupt ranged reads. Applied to remote fetches
// here for parity with the main-thread ranged paths.
function identityHeadersWorker(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    if (k.toLowerCase() === 'accept-encoding') continue;
    out[k] = headers[k];
  }
  out['Accept-Encoding'] = 'identity';
  return out;
}

function parseRetryAfterMsWorker(value) {
  if (!value) return undefined;
  const secs = parseInt(value, 10);
  if (!isFinite(secs) || String(secs) !== String(value).trim()) return undefined;
  return Math.min(secs * 1000, 30000);
}

// fetch wrapped in retry/backoff: retries transient network errors and
// retryable statuses (429/5xx), honoring Retry-After. Returns the Response for
// any non-retryable status so the caller handles it. Mirrors fetchRetrying in
// ../../io/remote.ts. Errors are NOT redacted here because the worker only ever
// sees URLs the main thread already resolved; the main thread re-wraps worker
// failures, and no token-bearing URL reaches this transport in the streaming
// path (Drive/headers route through the buffer download, not createLazyFile).
async function fetchRetryingWorker(url, init, retries) {
  const max = retries == null ? 3 : retries;
  let attempt = 0;
  while (true) {
    let response;
    let networkError = false;
    try {
      response = await fetch(url, init);
    } catch (e) {
      networkError = true;
    }
    if (!networkError && !RETRYABLE_STATUSES.has(response.status)) {
      return response;
    }
    if (attempt >= max) {
      if (networkError) throw new Error('Failed to fetch remote HDF5 file');
      return response;
    }
    let delayMs = Math.min(200 * Math.pow(2, attempt), 30000);
    if (!networkError) {
      const ra = parseRetryAfterMsWorker(
        response.headers && response.headers.get
          ? response.headers.get('Retry-After')
          : null,
      );
      if (ra != null) delayMs = Math.min(ra, 30000);
    }
    attempt += 1;
    await new Promise(function(r) { setTimeout(r, delayMs); });
  }
}
// Track how the current file was mounted so closeFile can clean up correctly:
// 'remote' = MEMFS dir + createLazyFile, 'local' = WORKERFS mount,
// 'buffer' = MEMFS dir + FS.writeFile. Required because FS.rmdir fails on
// non-empty dirs (errno 55) and on file paths (errno 54).
let mountType = null;
let currentFilename = null;

// Dual-bridge (write B-seam, append mode — openAppend/appendEmbeddedVideos): TWO
// h5wasm files open at once, a read-only SOURCE and a read+write DEST, both routed
// through the SAME rangeControl/rangeData/rangeMaxChunk below (the worker only ever
// blocks on one bridge op at a time, so sharing is safe) but distinguished by a
// 'source'/'dest' tag on every bridged request (see bridgeRead/bridgeWrite/
// bridgeTruncate). currentFile/mountPath/mountType above remain for the pre-existing
// SINGLE-file paths (openRangeFile/openLocalFile/etc); these dual-file
// globals are independent so the two families of open/close never collide.
let currentSourceFile = null;
let currentDestFile = null;
let sourceMountPath = null;
let sourceMountFilename = null;
let destMountPath = null;
let destMountFilename = null;

// B-seam range bridge: SharedArrayBuffer views the custom device uses to request
// bytes from the main thread synchronously (Atomics.wait). Set by openRangeFile /
// openAppend (whichever ran most recently — only one bridge is
// active at a time). Control layout: Int32[0] = STATE (1=REQUEST pending, 2=READY),
// Int32[1] = RETLEN.
let rangeControl = null;
let rangeData = null;
let rangeMaxChunk = 0;

// Write half of the B-seam: current logical size of the writable range file
// (tracked here because MEMFS \`contents\` is not the source of truth — the
// bridge, not the wasm heap, holds the bytes). Set by createWriteRangeFile /
// updated by stream_ops.write and node_ops.setattr (ftruncate). In append mode
// (openAppend) this is SEEDED to the dest file's pre-existing on-disk size (passed
// in as destSize) rather than 0, so h5wasm's fstat/usedBytes-based file-size probe
// sees the real size of the already-written bytes instead of an empty file.
let writeFileSize = 0;

self.onmessage = async function(e) {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'init':
        await initH5Wasm(payload?.h5wasmUrl);
        respond(id, { success: true });
        break;

      case 'openUrl':
        const urlResult = await openRemoteFile(payload.url, payload.filename, payload.headers);
        respond(id, urlResult);
        break;

      case 'openLocal':
        const localResult = await openLocalFile(payload.file, payload.filename);
        respond(id, localResult);
        break;

      case 'openBuffer':
        const bufferResult = await openBufferFile(payload.buffer, payload.filename);
        respond(id, bufferResult);
        break;

      case 'openRange':
        const rangeResult = openRangeFile(payload.sab, payload.size, payload.filename, payload.controlBytes);
        respond(id, rangeResult);
        break;

      case 'openAppend':
        const openAppendResult = openAppend(
          payload.sab,
          payload.controlBytes,
          payload.sourceFilename,
          payload.sourceSize,
          payload.destFilename,
          payload.destSize
        );
        respond(id, openAppendResult);
        break;

      case 'appendEmbeddedVideos':
        const appendResult = appendEmbeddedVideos(payload.entries);
        respond(id, appendResult);
        break;

      case 'getKeys':
        const keys = getKeys(payload.path);
        respond(id, { success: true, keys });
        break;

      case 'getAttr':
        const attr = getAttr(payload.path, payload.name);
        respond(id, { success: true, value: attr });
        break;

      case 'getAttrs':
        const attrs = getAttrs(payload.path);
        respond(id, { success: true, attrs });
        break;

      case 'getDatasetMeta':
        const meta = getDatasetMeta(payload.path);
        respond(id, { success: true, meta });
        break;

      case 'getDatasetValue':
        const data = getDatasetValue(payload.path, payload.slice);
        respond(id, { success: true, data }, data.transferables);
        break;

      case 'close':
        closeFile();
        respond(id, { success: true });
        break;

      default:
        respond(id, { success: false, error: 'Unknown message type: ' + type });
    }
  } catch (error) {
    // Robustly extract error message from various error types
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      // Handle Emscripten errors which may be objects with various properties
      errorMessage = error.message || error.error || error.reason || JSON.stringify(error);
    }
    respond(id, { success: false, error: errorMessage });
  }
};

function respond(id, data, transferables) {
  if (transferables) {
    self.postMessage({ id, ...data }, transferables);
  } else {
    self.postMessage({ id, ...data });
  }
}

async function initH5Wasm(h5wasmUrl) {
  if (h5wasmModule) return;

  // Default to CDN if no URL provided
  const url = h5wasmUrl || 'https://cdn.jsdelivr.net/npm/h5wasm@0.10.2/dist/iife/h5wasm.js';

  // Import h5wasm IIFE
  importScripts(url);

  // Wait for module to be ready
  await h5wasm.ready;
  h5wasmModule = h5wasm;
  // FS is exposed directly on h5wasm module after ready
  FS = h5wasm.FS;
}

async function openRemoteFile(url, filename = 'data.h5', headers) {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // createLazyFile (synchronous XHR) has NO header API. When custom headers are
  // present we cannot authenticate a range stream, so buffer-download the file
  // with the headers applied and mount it as a MEMFS buffer instead. Header-free
  // requests keep the efficient createLazyFile range streaming path.
  const hasHeaders = headers && typeof headers === 'object' && Object.keys(headers).length > 0;
  if (hasHeaders) {
    // Retried with backoff on transient failures / 429/5xx; identity encoding
    // forced so a gzip transfer-encoding can't corrupt the bytes.
    const response = await fetchRetryingWorker(url, { headers: identityHeadersWorker(headers) });
    if (!response.ok) {
      throw new Error('Failed to fetch remote HDF5 file: ' + response.status);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const basename = (filename.split('/').pop() || '').split('\\\\').pop() || 'data.h5';
    mountPath = '/remote-buffer-' + Date.now() + '/' + basename;
    mountType = 'buffer';
    currentFilename = basename;
    const dir = mountPath.substring(0, mountPath.lastIndexOf('/'));
    FS.mkdir(dir);
    FS.writeFile(mountPath, data);
    currentFile = new h5wasm.File(mountPath, 'r');
    return {
      success: true,
      path: currentFile.path,
      filename: currentFile.filename,
      keys: currentFile.keys()
    };
  }

  // Create mount point
  mountPath = '/remote-' + Date.now();
  mountType = 'remote';
  currentFilename = filename;
  FS.mkdir(mountPath);

  // Create lazy file - this enables range request streaming!
  FS.createLazyFile(mountPath, filename, url, true, false);

  // Open with h5wasm
  const filePath = mountPath + '/' + filename;
  currentFile = new h5wasm.File(filePath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

async function openLocalFile(file, filename) {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // Use provided filename or file.name
  const fname = filename || file.name || 'local.h5';

  // Create mount point for WORKERFS
  mountPath = '/local-' + Date.now();
  mountType = 'local';
  currentFilename = fname;
  FS.mkdir(mountPath);

  // Mount the file using WORKERFS (zero-copy access)
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, mountPath);

  // Open with h5wasm
  const filePath = mountPath + '/' + fname;
  currentFile = new h5wasm.File(filePath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

async function openBufferFile(buffer, filename = 'data.h5') {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // Write buffer to virtual filesystem
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Strip any directory components so MEMFS doesn't need recursive mkdir.
  const basename = (filename.split('/').pop() || '').split('\\\\').pop() || 'data.h5';
  mountPath = '/buffer-' + Date.now() + '/' + basename;
  mountType = 'buffer';
  currentFilename = basename;

  // Create parent directory
  const dir = mountPath.substring(0, mountPath.lastIndexOf('/'));
  FS.mkdir(dir);

  // Write file to virtual FS
  FS.writeFile(mountPath, data);

  // Open with h5wasm
  currentFile = new h5wasm.File(mountPath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

// B-seam: request [offset, offset+want) from the main thread and BLOCK the worker
// until it writes the bytes back into the shared data area and wakes us. Returns a
// view over the shared data area (valid only until the next bridgeRead) — callers
// copy immediately. \`want\` is capped to the data area size; the device loops.
// \`target\` ('source'|'dest'|undefined) is stamped onto the posted request so a
// dual-bridge main-thread listener (StreamingH5Writer.openAppend) can route the
// request to the right reader; the single-bridge paths (createRangeFile) pass no
// target, which is harmless — those listeners don't look at it.
function bridgeRead(offset, length, target) {
  var want = length < rangeMaxChunk ? length : rangeMaxChunk;
  Atomics.store(rangeControl, 0, 1);                                  // STATE = REQUEST
  self.postMessage({ type: 'rangeRequest', target: target, offset: offset, length: want });
  Atomics.wait(rangeControl, 0, 1);                                  // block until STATE != REQUEST
  var got = Atomics.load(rangeControl, 1);                           // RETLEN (acquire)
  return rangeData.subarray(0, got);
}

// Create a read-only Emscripten file node whose synchronous reads pull bytes via
// the bridge instead of XHR (mirrors FS.createLazyFile's node setup: forceLoadFile
// no-ops once \`contents\` is set, and usedBytes/fstat reads contents.length).
function createRangeFile(parent, name, size) {
  var contents = { length: size };
  var node = FS.createFile(parent, name, { isDevice: false, contents: contents }, true, false);
  node.contents = contents;
  Object.defineProperties(node, { usedBytes: { get: function() { return size; } } });
  var stream_ops = {};
  var origOps = node.stream_ops;
  for (var key in origOps) {
    (function(k, fn) {
      stream_ops[k] = function() { FS.forceLoadFile(node); return fn.apply(null, arguments); };
    })(key, origOps[key]);
  }
  stream_ops.read = function(stream, buffer, offset, length, position) {
    if (position >= size) return 0;
    var end = position + length;
    if (end > size) end = size;
    var got = 0;
    var pos = position;
    while (pos < end) {
      var chunk = bridgeRead(pos, end - pos);
      if (chunk.length === 0) break;                                  // short read / EOF
      buffer.set(chunk, offset + got);
      got += chunk.length;
      pos += chunk.length;
    }
    return got;
  };
  node.stream_ops = stream_ops;
  return node;
}

// Dual-bridge SOURCE device: identical to createRangeFile (read-only, fixed size)
// except its reads are tagged 'source' so a dual-bridge main-thread listener
// (StreamingH5Writer.openAppend) can route them to the source reader instead of
// the dest sink. Kept as a separate function (rather than parameterizing
// createRangeFile) so the already-shipped single-file read path is untouched.
function createSourceRangeFile(parent, name, size) {
  var contents = { length: size };
  var node = FS.createFile(parent, name, { isDevice: false, contents: contents }, true, false);
  node.contents = contents;
  Object.defineProperties(node, { usedBytes: { get: function() { return size; } } });
  var stream_ops = {};
  var origOps = node.stream_ops;
  for (var key in origOps) {
    (function(k, fn) {
      stream_ops[k] = function() { FS.forceLoadFile(node); return fn.apply(null, arguments); };
    })(key, origOps[key]);
  }
  stream_ops.read = function(stream, buffer, offset, length, position) {
    if (position >= size) return 0;
    var end = position + length;
    if (end > size) end = size;
    var got = 0;
    var pos = position;
    while (pos < end) {
      var chunk = bridgeRead(pos, end - pos, 'source');
      if (chunk.length === 0) break;                                  // short read / EOF
      buffer.set(chunk, offset + got);
      got += chunk.length;
      pos += chunk.length;
    }
    return got;
  };
  node.stream_ops = stream_ops;
  return node;
}

function openRangeFile(sab, size, filename, controlBytes) {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }
  closeFile();
  rangeControl = new Int32Array(sab, 0, 8);
  rangeData = new Uint8Array(sab, controlBytes || 32);
  rangeMaxChunk = rangeData.length;
  // Strip directory components: filenameHint is often a full path (e.g. a native
  // .slp path with slashes), and MEMFS would treat it as nested dirs that don't
  // exist -> ENOENT. Mirror openBufferFile's basename handling.
  var fname = (((filename || 'data.h5').split('/').pop() || '').split('\\\\').pop()) || 'data.h5';
  mountPath = '/range-' + Date.now();
  mountType = 'range';
  currentFilename = fname;
  FS.mkdir(mountPath);
  createRangeFile(mountPath, fname, size);
  const filePath = mountPath + '/' + fname;
  currentFile = new h5wasm.File(filePath, 'r');
  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

// Write half of the B-seam: copy the payload into the shared data area and BLOCK
// until the main thread has written it to disk and woken us. Loops for payloads
// larger than the data area. Throws on a signalled write error (result != 0).
// \`target\` is always 'dest' in practice (writes only ever go to the destination
// file) but is threaded through for symmetry with bridgeRead/bridgeTruncate.
function bridgeWrite(fileOffset, buffer, bufOffset, length, target) {
  var written = 0;
  while (written < length) {
    var want = (length - written) < rangeMaxChunk ? (length - written) : rangeMaxChunk;
    rangeData.set(buffer.subarray(bufOffset + written, bufOffset + written + want), 0);
    Atomics.store(rangeControl, 0, 3);                                   // STATE = WRITE_REQUEST
    self.postMessage({ type: 'writeRequest', target: target, offset: fileOffset + written, length: want });
    Atomics.wait(rangeControl, 0, 3);                                    // block until != WRITE_REQUEST
    if (Atomics.load(rangeControl, 1) !== 0) {
      throw new Error('bridgeWrite failed at offset ' + (fileOffset + written));
    }
    written += want;
  }
}

// Truncate/extend the backing file to len via the bridge; block until done.
// \`target\` is always 'dest' (only the destination file is ever truncated).
function bridgeTruncate(len, target) {
  Atomics.store(rangeControl, 0, 4);                                     // STATE = TRUNCATE_REQUEST
  self.postMessage({ type: 'truncateRequest', target: target, length: len });
  Atomics.wait(rangeControl, 0, 4);
  if (Atomics.load(rangeControl, 1) !== 0) throw new Error('bridgeTruncate failed at len ' + len);
}

// A WRITABLE Emscripten file node whose read/write/llseek/truncate are serviced
// by the bridge (Rust std::fs on the main thread) instead of MEMFS. Mirrors
// createRangeFile, but: canWrite=true, dynamic size (writeFileSize), and it
// overrides stream_ops.write + node_ops.setattr (ftruncate) on top of read.
//
// \`initialSize\` seeds writeFileSize (default 0). The dual-bridge APPEND case
// (openAppend) passes the dest file's actual pre-existing on-disk size here:
// h5wasm's file-size probe reads node.usedBytes (-> writeFileSize), so without
// this an existing non-empty file would appear to be 0 bytes and fail to open in
// 'a' mode. All bridge calls from this device are tagged 'dest' — this device only
// ever backs the destination file, never the source.
function createWriteRangeFile(parent, name, initialSize) {
  writeFileSize = initialSize || 0;
  var contents = { length: writeFileSize };
  var node = FS.createFile(parent, name, { isDevice: false, contents: contents }, true, true); // canRead, canWrite
  node.contents = contents;
  Object.defineProperties(node, { usedBytes: { get: function() { return writeFileSize; } } });

  // stream_ops: wrap defaults with forceLoadFile no-op (harmless; contents is set),
  // then override read (read-back of just-written metadata) and write.
  var stream_ops = {};
  var origStreamOps = node.stream_ops;
  for (var sk in origStreamOps) {
    (function(k, fn) {
      stream_ops[k] = function() { FS.forceLoadFile(node); return fn.apply(null, arguments); };
    })(sk, origStreamOps[sk]);
  }
  stream_ops.read = function(stream, buffer, offset, length, position) {
    if (position >= writeFileSize) return 0;
    var end = position + length;
    if (end > writeFileSize) end = writeFileSize;
    var got = 0, pos = position;
    while (pos < end) {
      var chunk = bridgeRead(pos, end - pos, 'dest');
      if (chunk.length === 0) break;
      buffer.set(chunk, offset + got);
      got += chunk.length;
      pos += chunk.length;
    }
    return got;
  };
  stream_ops.write = function(stream, buffer, offset, length, position) {
    bridgeWrite(position, buffer, offset, length, 'dest');
    if (position + length > writeFileSize) writeFileSize = position + length;
    return length;
  };
  // llseek: rely on the wrapped default (SEEK_END uses node.usedBytes -> writeFileSize).
  node.stream_ops = stream_ops;

  // node_ops: override setattr so ftruncate is bridged (NOT written into MEMFS contents).
  var node_ops = {};
  var origNodeOps = node.node_ops;
  for (var nk in origNodeOps) node_ops[nk] = origNodeOps[nk];
  node_ops.setattr = function(n, attr) {
    if (attr.size !== undefined && attr.size !== null) {
      bridgeTruncate(attr.size, 'dest');
      writeFileSize = attr.size;
    }
    if (attr.timestamp !== undefined) n.timestamp = attr.timestamp;
    // NOTE: deliberately do NOT call the default setattr (it would resize MEMFS contents).
  };
  node.node_ops = node_ops;
  return node;
}

// Dual-bridge foundation: open TWO h5wasm files at once through the ONE bridge
// (sab) — a read-only SOURCE (createSourceRangeFile, tag 'source') and a
// read+write DEST (createWriteRangeFile, tag 'dest') opened in h5wasm append mode
// ('a'). The Rust side of the dest file must already be open via write_open_append
// (no truncate) so its pre-existing bytes are intact on disk; \`destSize\` seeds
// writeFileSize so h5wasm sees the dest file's REAL current size instead of 0 (see
// createWriteRangeFile's doc comment) and can read its existing content.
function openAppend(sab, controlBytes, sourceFilename, sourceSize, destFilename, destSize) {
  if (!h5wasmModule) throw new Error('h5wasm not initialized');
  closeFile();

  rangeControl = new Int32Array(sab, 0, 8);
  rangeData = new Uint8Array(sab, controlBytes || 32);
  rangeMaxChunk = rangeData.length;

  var srcFname = (((sourceFilename || 'source.h5').split('/').pop() || '').split('\\\\').pop()) || 'source.h5';
  sourceMountPath = '/append-src-' + Date.now();
  sourceMountFilename = srcFname;
  FS.mkdir(sourceMountPath);
  createSourceRangeFile(sourceMountPath, srcFname, sourceSize);
  currentSourceFile = new h5wasm.File(sourceMountPath + '/' + srcFname, 'r');

  var dstFname = (((destFilename || 'dest.h5').split('/').pop() || '').split('\\\\').pop()) || 'dest.h5';
  destMountPath = '/append-dst-' + Date.now();
  destMountFilename = dstFname;
  FS.mkdir(destMountPath);
  createWriteRangeFile(destMountPath, dstFname, destSize);
  currentDestFile = new h5wasm.File(destMountPath + '/' + dstFname, 'a');

  return {
    success: true,
    sourceKeys: currentSourceFile.keys(),
    destKeys: currentDestFile.keys()
  };
}

// Per-window byte budget for appendEmbeddedVideos' streamed raw blob copy, and
// the HDF5 chunk length (elements) for the 1-D embedded video byte dataset.
// MUST match EMBED_WRITE_WINDOW_BYTES / EMBED_VIDEO_CHUNK_BYTES in write.ts
// (~line 558) — keep them in lockstep.
var EMBED_WRITE_WINDOW_BYTES = 32 * 1024 * 1024;
var EMBED_VIDEO_CHUNK_BYTES = 1 << 20;

// Reinterpret an h5wasm slice()/value read as a Uint8Array without copying when
// possible (mirrors asUint8Array in ../../video/embedded-frame.ts — KEEP IN
// LOCKSTEP). Crucially this reinterprets an Int8Array's (h5wasm dtype '<b')
// bytes as unsigned, matching how the image bytes were originally written.
function asUint8ArrayWorker(value) {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

// Per-sourceGroup cache for readSourceBlob: the classified storage layout, the
// live h5wasm video Dataset handle, and (when present) frame_sizes read ONCE
// as an Int32Array. Populated by getSourceBlobGroupInfo on first use per group.
var sourceBlobGroupCache = {};

// Classify + cache one embedded video group's layout/video-dataset/frame_sizes
// from the open SOURCE file. Mirrors classifyLayout in
// ../../video/embedded-frame.ts (KEEP IN LOCKSTEP) EXCEPT the 1-D vlen-vs-concat
// split is resolved from the dataset's own vlen METADATA (available directly
// here, since the worker holds the live h5wasm Dataset) rather than comparing
// shape[0] to a separately-known frame count.
function getSourceBlobGroupInfo(sourceGroup) {
  var info = sourceBlobGroupCache[sourceGroup];
  if (info) return info;
  if (!currentSourceFile) throw new Error('readSourceBlob: no source file open (call openAppend first)');
  var videoDs = currentSourceFile.get(sourceGroup + '/video');
  if (!videoDs) throw new Error('readSourceBlob: source dataset not found: ' + sourceGroup + '/video');
  var shape = videoDs.shape || [];
  var layout;
  if (shape.length >= 2) {
    layout = 'padded';
  } else {
    var M = h5wasmModule && h5wasmModule.Module;
    var md = videoDs.metadata;
    var vlenClass = (M && M.H5T_class_t && M.H5T_class_t.H5T_VLEN) ? M.H5T_class_t.H5T_VLEN.value : 9;
    var isVlen = !!(md && (md.vlen === true || md.type === vlenClass));
    layout = isVlen ? 'vlen' : 'concat';
  }
  var frameSizes = null;
  try {
    var fsDs = currentSourceFile.get(sourceGroup + '/frame_sizes');
    if (fsDs) {
      var raw = fsDs.value;
      frameSizes = raw instanceof Int32Array ? raw : Int32Array.from(raw);
    }
  } catch (e) { /* no frame_sizes dataset (legacy source) - leave null */ }
  info = { layout: layout, videoDs: videoDs, frameSizes: frameSizes, offsets: null };
  sourceBlobGroupCache[sourceGroup] = info;
  return info;
}

// Worker port of readEmbeddedFrameBytes (../../video/embedded-frame.ts — KEEP IN
// LOCKSTEP) for the raw source->dest copy path only: returns the raw stored
// blob (Uint8Array, NO decode) for stored-frame \`index\` (0-based storage-order
// index, NOT a source frame number) of the embedded video group \`sourceGroup\`
// in the open SOURCE file. Supports all three storage layouts. Returns null if
// the frame cannot be located (caller treats that as a dropped frame).
function readSourceBlob(sourceGroup, index) {
  var info = getSourceBlobGroupInfo(sourceGroup);
  var sizes = info.frameSizes;

  // padded (2-D, and N-D raw): slice row \`index\` only, then trim to
  // frame_sizes[index] when known (mirrors trimPaddedRow's exact-size branch;
  // for a fixed-size raw row frame_sizes[index] === row.length, so this is a
  // no-op trim there).
  if (info.layout === 'padded') {
    var shape = info.videoDs.shape;
    var slice = shape.map(function(dim, d) { return d === 0 ? [index, index + 1] : [0, dim]; });
    var row = asUint8ArrayWorker(info.videoDs.slice(slice));
    if (!row) return null;
    var size = sizes ? sizes[index] : undefined;
    if (size != null && size >= 0 && size <= row.length) {
      return size === row.length ? row : row.subarray(0, size);
    }
    return row;
  }

  // vlen (legacy pkg.slp): one encoded image per element. h5wasm's high-level
  // single-element slice is memory-unsafe here (its post-read vlen reclaim
  // walks the FULL dataset dataspace over a one-element buffer and corrupts the
  // heap), so read the one hvl_t element manually — the exact approach used in
  // getDatasetValue's vlen branch above (and readVlenElementManual in
  // ../../video/embedded-frame.ts) — freeing only that element's inner blob.
  if (info.layout === 'vlen') {
    var M = h5wasmModule && h5wasmModule.Module;
    var md = info.videoDs.metadata;
    if (M && M._malloc && M.get_dataset_data && M.HEAPU8 && M._free && md && md.size === 8) {
      var dataPtr = M._malloc(md.size);
      if (!dataPtr) throw new Error('readSourceBlob: malloc failed for vlen element ' + index);
      try {
        M.get_dataset_data(info.videoDs.file_id, info.videoDs.path, [1n], [BigInt(index)], [1n], BigInt(dataPtr));
        // HEAPU32 isn't exported; build the view over HEAPU8.buffer each call
        // (heap growth can detach the previous ArrayBuffer).
        var u32 = new Uint32Array(M.HEAPU8.buffer, Number(dataPtr), 2);
        var len = u32[0];
        var blobPtr = u32[1];
        if (!blobPtr) return new Uint8Array(0);
        var out = M.HEAPU8.slice(blobPtr, blobPtr + len);
        M._free(blobPtr); // free ONLY the inner blob - the per-element reclaim
        return out;
      } finally {
        M._free(dataPtr);
      }
    }
    // Can't do the manual single-element read (unexpected hvl_t size / no
    // Module access) - fall back to a whole-dataset read (safe, higher memory).
    var whole = info.videoDs.value;
    return Array.isArray(whole) ? asUint8ArrayWorker(whole[index]) : null;
  }

  // concat: 1-D fixed <B, all frames concatenated - exact byte-range slice via
  // the cumulative sum of frame_sizes[0..index), computed once and cached.
  if (!sizes) throw new Error('readSourceBlob: concat layout requires frame_sizes at ' + sourceGroup);
  if (!info.offsets) {
    var offsets = new Array(sizes.length);
    var off = 0;
    for (var i = 0; i < sizes.length; i++) { offsets[i] = off; off += sizes[i]; }
    info.offsets = offsets;
  }
  var start = info.offsets[index];
  var end = start + sizes[index];
  return asUint8ArrayWorker(info.videoDs.slice([[start, end]]));
}

// Worker-side setStringAttr (mirrors write.ts's setStringAttr - KEEP IN
// LOCKSTEP): a fixed-length HDF5 string attribute (h5py reads it back as
// bytes, so Python's .decode() still works).
function setStringAttrWorker(target, name, value) {
  var byteLength = new TextEncoder().encode(value).length;
  target.create_attribute(name, value, null, 'S' + byteLength);
}

// Worker-side writeSourceVideoJson (mirrors write.ts's writeSourceVideoJson -
// KEEP IN LOCKSTEP): writes the source video's metadata JSON into
// '{groupPath}/source_video', normally as a 'json' string attribute, or (only
// if it would exceed the 64 KB HDF5 attribute ceiling) a 'json' dataset in the
// same group instead.
function writeSourceVideoJsonWorker(file, groupPath, sourceDict) {
  var blob = JSON.stringify(sourceDict);
  file.create_group(groupPath + '/source_video');
  var byteLength = new TextEncoder().encode(blob).length;
  if (byteLength <= 64000) {
    setStringAttrWorker(file.get(groupPath + '/source_video'), 'json', blob);
    return;
  }
  file.create_dataset({ name: groupPath + '/source_video/json', data: [blob] });
}

// Worker port of writeEmbeddedVideoData (write.ts ~2852) for the RAW path ONLY
// (SerializableEmbedEntry - Task 1.1's re-save/raw-copy embed plan). Requires
// openAppend to have already opened BOTH currentSourceFile and currentDestFile.
// For each entry: creates 'video{videoIndex}' in the DEST, writes the
// source_video lineage (if any), then streams the SOURCE group's stored blobs
// (via readSourceBlob) into a new resizable 1-D <B 'video{videoIndex}/video'
// dataset in bounded byte windows (mirrors writeRawEmbeddedVideo's create-empty
// -> resize -> write_slice window pattern), and finally writes
// frame_numbers/frame_sizes + format/channel_order attrs. Does NOT close either
// file (the caller's subsequent 'close' message does that via closeAppendFiles,
// so more writes could still follow).
//
// Backstop (mirrors the #213 data-loss guard in writeEmbeddedVideoData): an
// entry's frameNumbers IS the exact stored set, so every stored index must read
// a blob - if fewer blobs were read than planned, THROW rather than silently
// write a file with the images stripped.
function appendEmbeddedVideos(entries) {
  if (!currentSourceFile) throw new Error('appendEmbeddedVideos: no source file open (call openAppend first)');
  if (!currentDestFile) throw new Error('appendEmbeddedVideos: no dest file open (call openAppend first)');

  var perVideo = [];
  for (var e = 0; e < entries.length; e++) {
    var entry = entries[e];
    var group = 'video' + entry.videoIndex;
    currentDestFile.create_group(group);

    if (entry.sourceVideoJson) {
      writeSourceVideoJsonWorker(currentDestFile, group, entry.sourceVideoJson);
    }

    currentDestFile.create_dataset({
      name: group + '/video',
      data: new Uint8Array(0),
      shape: [0],
      maxshape: [null],
      chunks: [EMBED_VIDEO_CHUNK_BYTES],
      dtype: '<B'
    });
    var vds = currentDestFile.get(group + '/video'); // re-fetch handle (mirror write.ts pattern)

    var sizes = [];
    var writtenFns = [];
    var total = 0;
    var win = [];
    var winBytes = 0;
    var flush = function() {
      if (winBytes === 0) return;
      var buf = new Uint8Array(winBytes);
      var o = 0;
      for (var k = 0; k < win.length; k++) { buf.set(win[k], o); o += win[k].length; }
      vds.resize([total + winBytes]);
      vds.write_slice([[total, total + winBytes]], buf);
      total += winBytes;
      win = [];
      winBytes = 0;
    };

    for (var i = 0; i < entry.frameNumbers.length; i++) {
      var blob = readSourceBlob(entry.sourceGroup, i);
      if (!blob || blob.length === 0) continue;
      win.push(blob);
      winBytes += blob.length;
      sizes.push(blob.length);
      writtenFns.push(entry.frameNumbers[i]);
      if (winBytes >= EMBED_WRITE_WINDOW_BYTES) flush();
    }
    flush();

    if (writtenFns.length < entry.frameNumbers.length) {
      throw new Error(
        'embedding video' + entry.videoIndex + ': read ' + writtenFns.length + ' of ' +
        entry.frameNumbers.length + ' planned frame(s) - refusing to write a file with dropped images.'
      );
    }

    setStringAttrWorker(vds, 'format', entry.format);
    setStringAttrWorker(vds, 'channel_order', entry.channelOrder);

    currentDestFile.create_dataset({
      name: group + '/frame_numbers',
      data: writtenFns,
      shape: [writtenFns.length],
      dtype: '<i4'
    });
    currentDestFile.create_dataset({
      name: group + '/frame_sizes',
      data: sizes,
      shape: [sizes.length],
      dtype: '<i4'
    });

    perVideo.push({ videoIndex: entry.videoIndex, framesWritten: writtenFns.length });
  }

  currentDestFile.flush();
  return { success: true, perVideo: perVideo };
}

function getKeys(path) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  return item.keys ? item.keys() : [];
}

function serializeAttrValue(attr) {
  if (!attr) return null;
  // h5wasm Attribute objects have a .value property
  const val = attr.value !== undefined ? attr.value : attr;
  // Convert Uint8Array to string for JSON attributes
  if (val instanceof Uint8Array) {
    return { value: new TextDecoder().decode(val) };
  }
  // Wrap primitive values to preserve structure
  return { value: val };
}

function getAttr(path, name) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  const attrs = item.attrs;
  const attr = attrs?.[name];
  return serializeAttrValue(attr);
}

function getAttrs(path) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  const rawAttrs = item.attrs || {};
  // Serialize all attributes for proper transfer through postMessage
  const serialized = {};
  for (const key of Object.keys(rawAttrs)) {
    serialized[key] = serializeAttrValue(rawAttrs[key]);
  }
  return serialized;
}

function getDatasetMeta(path) {
  if (!currentFile) throw new Error('No file open');
  const dataset = currentFile.get(path);
  if (!dataset) throw new Error('Dataset not found: ' + path);
  return {
    shape: dataset.shape,
    dtype: dataset.dtype,
    metadata: dataset.metadata
  };
}

// Read a fixed-size 1-D compound dataset column-wise straight from the record
// blob, skipping h5wasm's Dataset.value (which allocates ~8 Uint8Array.slice per
// record — the dominant cost of opening a large project). Mirrors
// readCompoundColumnsManual in ./h5-compound.ts (keep them in lockstep). Returns
// { columns: { memberName: Float64Array }, buffers: ArrayBuffer[] } — the buffers
// are the postMessage transfer list so the columns move to the main thread
// instead of being structured-cloned. Returns null (caller falls back to .value)
// for anything not a plain-numeric compound. Values match .value except int64
// comes back as number (every consumer routes these through Number()).
function readCompoundColumnsWorker(dataset, M) {
  const md = dataset.metadata;
  const members = md && md.compound_type && md.compound_type.members;
  if (!members || !members.length || (md && md.vlen)) return null;
  const shape = dataset.shape;
  if (!shape || shape.length !== 1) return null;
  const recSize = md.size;
  if (!recSize || recSize <= 0) return null;
  for (let k = 0; k < members.length; k++) {
    const mt = members[k];
    if (mt.type !== 0 && mt.type !== 1 && mt.type !== 8) return null;
    if (mt.type === 1 && mt.size !== 8 && mt.size !== 4) return null;
    if (mt.size !== 1 && mt.size !== 2 && mt.size !== 4 && mt.size !== 8) return null;
  }
  if (!(M && M._malloc && M.get_dataset_data && M.HEAPU8 && M._free)) return null;
  const n = shape[0];
  // Columns are Float64Array (every SLEAP field — coords, scores, and integer
  // id/index columns up to 2^53 — is exact in f64) so their backing buffers can
  // be TRANSFERRED to the main thread instead of structured-cloned. \`buffers\`
  // is the postMessage transfer list.
  const columns = {};
  const buffers = [];
  if (n === 0) {
    for (let z = 0; z < members.length; z++) {
      const c = new Float64Array(0);
      columns[members[z].name] = c;
      buffers.push(c.buffer);
    }
    return { columns: columns, buffers: buffers };
  }
  const nbytes = recSize * n;
  const dptr = M._malloc(nbytes);
  if (!dptr) return null;
  let buf;
  try {
    M.get_dataset_data(dataset.file_id, dataset.path, [BigInt(n)], [0n], [1n], BigInt(dptr));
    buf = M.HEAPU8.slice(dptr, dptr + nbytes);
  } finally {
    M._free(dptr);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let j = 0; j < members.length; j++) {
    const m = members[j];
    const col = new Float64Array(n);
    const off = m.offset, sz = m.size, isFloat = (m.type === 1);
    const signed = (m.signed !== false), le = (m.littleEndian !== false);
    for (let i = 0; i < n; i++) {
      const p = i * recSize + off;
      let v;
      if (isFloat) v = sz === 8 ? dv.getFloat64(p, le) : dv.getFloat32(p, le);
      else if (sz === 1) v = signed ? dv.getInt8(p) : dv.getUint8(p);
      else if (sz === 2) v = signed ? dv.getInt16(p, le) : dv.getUint16(p, le);
      else if (sz === 4) v = signed ? dv.getInt32(p, le) : dv.getUint32(p, le);
      else v = Number(signed ? dv.getBigInt64(p, le) : dv.getBigUint64(p, le));
      col[i] = v;
    }
    columns[m.name] = col;
    buffers.push(col.buffer);
  }
  return { columns: columns, buffers: buffers };
}

function getDatasetValue(path, slice) {
  if (!currentFile) throw new Error('No file open');
  const dataset = currentFile.get(path);
  if (!dataset) throw new Error('Dataset not found: ' + path);

  // Variable-length (vlen) datasets: h5wasm's high-level dataset.slice() corrupts
  // the heap here — its post-read reclaim walks the FULL dataset dataspace over a
  // single-element buffer (intermittent "memory access out of bounds" / abort).
  // So NEVER call dataset.slice() on a vlen dataset. For a single-element slice we
  // read the one hvl_t manually and free only that element (mirrors
  // readVlenElementManual in ../../video/embedded-frame.ts — keep them in lockstep).
  const M = h5wasmModule && h5wasmModule.Module;
  const md = dataset.metadata;
  const vlenClass = (M && M.H5T_class_t && M.H5T_class_t.H5T_VLEN) ? M.H5T_class_t.H5T_VLEN.value : 9;
  const isVlen = !!(md && (md.vlen === true || md.type === vlenClass));
  if (isVlen) {
    const single = slice && Array.isArray(slice) && slice.length === 1 &&
      Array.isArray(slice[0]) && slice[0].length === 2;
    if (single && md.size === 8 && M && M._malloc && M.get_dataset_data && M.HEAPU8) {
      const index = slice[0][0];
      const dataPtr = M._malloc(md.size);
      let out;
      try {
        M.get_dataset_data(dataset.file_id, dataset.path, [1n], [BigInt(index)], [1n], BigInt(dataPtr));
        // HEAPU32 isn't exported; build the view over HEAPU8.buffer each call
        // (heap growth can detach the previous ArrayBuffer).
        const u32 = new Uint32Array(M.HEAPU8.buffer, Number(dataPtr), 2);
        const len = u32[0];
        const blobPtr = u32[1];
        out = blobPtr ? M.HEAPU8.slice(blobPtr, blobPtr + len) : new Uint8Array(0);
        if (blobPtr) M._free(blobPtr); // free ONLY the inner blob
      } finally {
        M._free(dataPtr);
      }
      return {
        value: { type: 'typedarray', dtype: 'Uint8Array', buffer: out.buffer, byteOffset: out.byteOffset, length: out.length },
        shape: dataset.shape,
        dtype: dataset.dtype,
        transferables: [out.buffer]
      };
    }
    // Can't do the manual single-element read (whole read, or unexpected hvl_t
    // size). Read the whole vlen dataset (safe) and return the array of blobs;
    // the caller indexes into it. structuredClone copies it (no transfer).
    return {
      value: dataset.value,
      shape: dataset.shape,
      dtype: dataset.dtype,
      transferables: []
    };
  }

  // Fixed-size compound full read (frames/instances/points/pred_points): return
  // per-member columns read directly from the record blob, skipping h5wasm's slow
  // Dataset.value. normalizeStructData accepts a { field: array } record as-is, so
  // no caller change is needed; falls through to .value when not applicable.
  if (!slice) {
    const res = readCompoundColumnsWorker(dataset, M);
    if (res) {
      return {
        value: { type: 'columns', columns: res.columns },
        shape: dataset.shape,
        dtype: dataset.dtype,
        transferables: res.buffers
      };
    }
  }

  // Non-vlen: hyperslab slice or whole read as requested.
  let value;
  if (slice && Array.isArray(slice)) {
    value = dataset.slice(slice);
  } else {
    value = dataset.value;
  }

  // Prepare for transfer
  const transferables = [];
  let transferValue = value;

  if (ArrayBuffer.isView(value)) {
    // TypedArray - transfer the underlying buffer
    transferValue = {
      type: 'typedarray',
      dtype: value.constructor.name,
      buffer: value.buffer,
      byteOffset: value.byteOffset,
      length: value.length
    };
    transferables.push(value.buffer);
  } else if (value instanceof ArrayBuffer) {
    transferValue = { type: 'arraybuffer', buffer: value };
    transferables.push(value);
  }

  return {
    value: transferValue,
    shape: dataset.shape,
    dtype: dataset.dtype,
    transferables
  };
}

// Shared best-effort cleanup logger for closeFile/closeAppendFiles — FS.unlink/
// FS.rmdir/FS.unmount failures during teardown are non-fatal (the worker is
// closing this file/mount regardless) but shouldn't be silently swallowed.
function warnCleanup(op, path, e) {
  try {
    var msg = '[h5-worker] cleanup ' + op + '(' + path + ') failed: ' + (e && (e.message || e.errno || e));
    if (typeof console !== 'undefined' && console.warn) console.warn(msg);
  } catch (_) {}
}

// Tear down the dual-bridge SOURCE + DEST files/mounts (openAppend /
// appendEmbeddedVideos). Safe to call when neither is open (e.g. the single-file
// paths never touch these globals). Called from closeFile() so a plain 'close'
// message cleans up dual-bridge state too, and from openAppend() itself so a
// second openAppend without an intervening close doesn't leak the first pair of
// MEMFS mounts.
function closeAppendFiles() {
  if (currentSourceFile) {
    try { currentSourceFile.close(); } catch (e) {}
    currentSourceFile = null;
  }
  if (currentDestFile) {
    try { currentDestFile.close(); } catch (e) {}
    currentDestFile = null;
  }
  if (sourceMountPath && FS) {
    var srcPath = sourceMountPath + '/' + sourceMountFilename;
    try { FS.unlink(srcPath); } catch (e) { warnCleanup('unlink', srcPath, e); }
    try { FS.rmdir(sourceMountPath); } catch (e) { warnCleanup('rmdir', sourceMountPath, e); }
    sourceMountPath = null;
    sourceMountFilename = null;
  }
  if (destMountPath && FS) {
    var dstPath = destMountPath + '/' + destMountFilename;
    try { FS.unlink(dstPath); } catch (e) { warnCleanup('unlink', dstPath, e); }
    try { FS.rmdir(destMountPath); } catch (e) { warnCleanup('rmdir', destMountPath, e); }
    destMountPath = null;
    destMountFilename = null;
  }
}

function closeFile() {
  if (currentFile) {
    try { currentFile.close(); } catch (e) {}
    currentFile = null;
  }
  if (mountPath && FS) {
    // Cleanup sequence depends on how the file was mounted. FS.rmdir requires
    // an empty dir; FS.rmdir on a file path fails with errno 54. Without the
    // right sequence per mount type, repeated open/close cycles leak MEMFS
    // entries (and for 'buffer' mounts, the entire file bytes) for the lifetime
    // of the worker.
    if (mountType === 'buffer') {
      // mountPath is the file; parent dir was created by FS.mkdir.
      var parent = mountPath.substring(0, mountPath.lastIndexOf('/'));
      try { FS.unlink(mountPath); } catch (e) { warnCleanup('unlink', mountPath, e); }
      try { FS.rmdir(parent); } catch (e) { warnCleanup('rmdir', parent, e); }
    } else if (mountType === 'remote' || mountType === 'range' || mountType === 'writerange') {
      // mountPath is the dir containing the lazy / range-backed file.
      var lazyPath = mountPath + '/' + currentFilename;
      try { FS.unlink(lazyPath); } catch (e) { warnCleanup('unlink', lazyPath, e); }
      try { FS.rmdir(mountPath); } catch (e) { warnCleanup('rmdir', mountPath, e); }
    } else if (mountType === 'local') {
      // WORKERFS mount must be unmounted before rmdir.
      try { FS.unmount(mountPath); } catch (e) { warnCleanup('unmount', mountPath, e); }
      try { FS.rmdir(mountPath); } catch (e) { warnCleanup('rmdir', mountPath, e); }
    } else {
      // Unknown mount type — best effort rmdir (preserves pre-existing behavior).
      try { FS.rmdir(mountPath); } catch (e) { warnCleanup('rmdir', mountPath, e); }
    }
    mountPath = null;
    mountType = null;
    currentFilename = null;
  }
  closeAppendFiles();
}
`;

/**
 * Create a Web Worker from the inline code.
 * @returns Worker instance ready for HDF5 streaming operations
 */
export function createH5Worker(): Worker {
  const blob = new Blob([H5_WORKER_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  // Clean up blob URL after worker loads
  worker.addEventListener(
    "error",
    () => {
      URL.revokeObjectURL(url);
    },
    { once: true },
  );

  return worker;
}

/**
 * Message types for worker communication.
 */
export type H5WorkerMessageType =
  | "init"
  | "openUrl"
  | "openLocal"
  | "openBuffer"
  | "openRange"
  | "openAppend"
  | "appendEmbeddedVideos"
  | "getKeys"
  | "getAttr"
  | "getAttrs"
  | "getDatasetMeta"
  | "getDatasetValue"
  | "close";

export interface H5WorkerMessage {
  type: H5WorkerMessageType;
  payload?: Record<string, unknown>;
  id: number;
}

export interface H5WorkerResponse {
  id: number;
  success: boolean;
  error?: string;
  [key: string]: unknown;
}
