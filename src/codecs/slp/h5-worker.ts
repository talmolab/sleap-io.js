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
    const warn = function(op, path, e) {
      try {
        var msg = '[h5-worker] cleanup ' + op + '(' + path + ') failed: ' + (e && (e.message || e.errno || e));
        if (typeof console !== 'undefined' && console.warn) console.warn(msg);
      } catch (_) {}
    };
    if (mountType === 'buffer') {
      // mountPath is the file; parent dir was created by FS.mkdir.
      var parent = mountPath.substring(0, mountPath.lastIndexOf('/'));
      try { FS.unlink(mountPath); } catch (e) { warn('unlink', mountPath, e); }
      try { FS.rmdir(parent); } catch (e) { warn('rmdir', parent, e); }
    } else if (mountType === 'remote') {
      // mountPath is the dir containing the lazy file.
      var lazyPath = mountPath + '/' + currentFilename;
      try { FS.unlink(lazyPath); } catch (e) { warn('unlink', lazyPath, e); }
      try { FS.rmdir(mountPath); } catch (e) { warn('rmdir', mountPath, e); }
    } else if (mountType === 'local') {
      // WORKERFS mount must be unmounted before rmdir.
      try { FS.unmount(mountPath); } catch (e) { warn('unmount', mountPath, e); }
      try { FS.rmdir(mountPath); } catch (e) { warn('rmdir', mountPath, e); }
    } else {
      // Unknown mount type — best effort rmdir (preserves pre-existing behavior).
      try { FS.rmdir(mountPath); } catch (e) { warn('rmdir', mountPath, e); }
    }
    mountPath = null;
    mountType = null;
    currentFilename = null;
  }
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
