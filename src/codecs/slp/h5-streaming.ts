/**
 * Streaming HDF5 file access via Web Worker.
 *
 * This module provides a high-level API for accessing remote HDF5 files
 * using HTTP range requests for efficient streaming. The actual HDF5
 * operations run in a Web Worker where synchronous XHR is allowed.
 *
 * @module
 */

import {
  createH5Worker,
  type H5WorkerMessage,
  type H5WorkerResponse,
} from "./h5-worker.js";
import { RemoteIOError, isUrl, resolveUrl } from "../../io/remote.js";

/**
 * Options for opening a streaming HDF5 file.
 */
export interface StreamingH5Options {
  /** URL to h5wasm IIFE bundle. Defaults to CDN. */
  h5wasmUrl?: string;
  /** Filename hint for the HDF5 file. */
  filenameHint?: string;
  /**
   * Extra HTTP request headers forwarded to the worker's `openUrl`. When
   * non-empty, the worker buffer-downloads the file (authenticated) instead of
   * using header-free `createLazyFile` range streaming.
   */
  headers?: Record<string, string>;
}

/**
 * A lazy random-access byte source backed by native reads (e.g. a Tauri
 * `read_range` command). The streaming Worker pulls slices on demand through a
 * SharedArrayBuffer + `Atomics` bridge (the "B-seam" range reader), so large
 * files are never fully materialized in WASM memory. `readRange` runs on the
 * MAIN thread (the Worker cannot do the native IPC itself).
 */
export interface RangeSource {
  /** Total file size in bytes. */
  size: number;
  /** Read `[offset, offset + length)`; may return fewer bytes at EOF. */
  readRange: (offset: number, length: number) => Promise<Uint8Array>;
}

/** Type guard for {@link RangeSource}. */
export function isRangeSource(source: unknown): source is RangeSource {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as RangeSource).size === "number" &&
    typeof (source as RangeSource).readRange === "function"
  );
}

/**
 * Source types supported by the streaming HDF5 file.
 */
export type StreamingH5Source =
  | string
  | ArrayBuffer
  | Uint8Array
  | File
  | RangeSource;

/**
 * Reconstructs a TypedArray from transferred worker data.
 */
function reconstructValue(data: unknown): unknown {
  if (data && typeof data === "object" && "type" in data) {
    const typed = data as {
      type: string;
      dtype?: string;
      buffer?: ArrayBuffer;
      byteOffset?: number;
      length?: number;
    };

    if (typed.type === "typedarray" && typed.buffer) {
      const TypedArrayConstructor = getTypedArrayConstructor(
        typed.dtype || "Uint8Array",
      );
      return new TypedArrayConstructor(
        typed.buffer,
        typed.byteOffset || 0,
        typed.length,
      );
    }

    if (typed.type === "arraybuffer" && typed.buffer) {
      return typed.buffer;
    }
  }

  return data;
}

function getTypedArrayConstructor(
  name: string,
): new (
  buffer: ArrayBuffer,
  byteOffset: number,
  length?: number,
) => ArrayBufferView {
  const constructors: Record<
    string,
    new (
      buffer: ArrayBuffer,
      byteOffset: number,
      length?: number,
    ) => ArrayBufferView
  > = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  };
  return constructors[name] || Uint8Array;
}

/**
 * A streaming HDF5 file handle that uses a Web Worker for range request access.
 *
 * This class provides an API similar to h5wasm.File but operates via message
 * passing to a worker where createLazyFile enables HTTP range requests.
 */
export class StreamingH5File {
  private worker: Worker;
  private messageId = 0;
  private pendingMessages = new Map<
    number,
    {
      resolve: (value: H5WorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private _keys: string[] = [];
  private _isOpen = false;

  // B-seam range bridge (set by openRange): the app-provided reader plus the
  // SharedArrayBuffer views the Worker blocks on. See serviceRangeRequest.
  private rangeReader?: (offset: number, length: number) => Promise<Uint8Array>;
  private rangeControl?: Int32Array;
  private rangeData?: Uint8Array;

  constructor() {
    this.worker = createH5Worker();
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }

  private handleMessage(e: MessageEvent<H5WorkerResponse>): void {
    // B-seam: the Worker's custom device asks the main thread for bytes. This is
    // a Worker->main request (not an id-correlated response), so handle it first.
    const msg = e.data as unknown as {
      type?: string;
      offset?: number;
      length?: number;
    };
    if (msg && msg.type === "rangeRequest") {
      this.serviceRangeRequest(msg.offset ?? 0, msg.length ?? 0);
      return;
    }

    const { id, ...data } = e.data;
    const pending = this.pendingMessages.get(id);
    if (pending) {
      this.pendingMessages.delete(id);
      if (data.success) {
        pending.resolve(e.data);
      } else {
        // Ensure error is a string for the Error message
        let errorMessage = "Worker operation failed";
        if (typeof data.error === "string") {
          errorMessage = data.error;
        } else if (data.error && typeof data.error === "object") {
          errorMessage = JSON.stringify(data.error);
        }
        pending.reject(new Error(errorMessage));
      }
    }
  }

  private handleError(e: ErrorEvent): void {
    console.error("[StreamingH5File] Worker error:", e.message);
    // Reject all pending messages
    for (const [id, pending] of this.pendingMessages) {
      pending.reject(new Error(`Worker error: ${e.message}`));
      this.pendingMessages.delete(id);
    }
  }

  private send(
    type: H5WorkerMessage["type"],
    payload?: Record<string, unknown>,
  ): Promise<H5WorkerResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingMessages.set(id, { resolve, reject });
      this.worker.postMessage({ type, payload, id });
    });
  }

  /**
   * Initialize the h5wasm module in the worker.
   */
  async init(options?: StreamingH5Options): Promise<void> {
    await this.send("init", { h5wasmUrl: options?.h5wasmUrl });
  }

  /**
   * Open a remote HDF5 file for streaming access via URL.
   *
   * The scheme is resolved on the MAIN thread (the worker cannot import the
   * scheme gate): `gs://`/`gcs://` are mapped to `storage.googleapis.com`, and
   * `s3://`/`az://`/`abfs://` fail fast with a redacted {@link RemoteIOError}.
   * Google Drive is NOT supported on the streaming worker path (Drive requires a
   * buffered, interstitial-following download, not range streaming); a Drive URL
   * throws a redacted {@link RemoteIOError} directing the caller to the
   * non-streaming reader. The worker only ever fetches an already-resolved
   * http(s) URL.
   *
   * @param url - URL to the HDF5 file (must support HTTP range requests)
   * @param options - Optional settings
   */
  async open(url: string, options?: StreamingH5Options): Promise<void> {
    // Initialize if not already done
    await this.init(options);

    // Resolve the scheme up front so gs:// works in explicit stream mode (the
    // worker can't resolve it) and unsupported schemes / Drive fail fast with a
    // redacted typed error rather than a confusing worker error.
    let resolvedUrl = url;
    if (isUrl(url)) {
      const { url: resolved, gdrive } = resolveUrl(url);
      if (gdrive) {
        throw new RemoteIOError({
          message:
            'Google Drive URLs are not supported on the streaming worker path (Drive needs a buffered download); use the non-streaming reader (stream:"download" / loadSlp)',
          url,
          status: null,
        });
      }
      resolvedUrl = resolved;
    }

    const filename =
      options?.filenameHint ||
      resolvedUrl.split("/").pop()?.split("?")[0] ||
      "data.h5";
    const result = await this.send("openUrl", {
      url: resolvedUrl,
      filename,
      headers: options?.headers,
    });
    this._keys = (result.keys as string[]) || [];
    this._isOpen = true;
  }

  /**
   * Open a local File object using WORKERFS (zero-copy).
   *
   * @param file - File object from file input or drag-and-drop
   * @param options - Optional settings
   */
  async openLocal(file: File, options?: StreamingH5Options): Promise<void> {
    // Initialize if not already done
    await this.init(options);

    const filename = options?.filenameHint || file.name || "data.h5";
    const result = await this.send("openLocal", { file, filename });
    this._keys = (result.keys as string[]) || [];
    this._isOpen = true;
  }

  /**
   * Open an HDF5 file from an ArrayBuffer or Uint8Array.
   *
   * @param buffer - ArrayBuffer or Uint8Array containing the HDF5 file data
   * @param options - Optional settings
   */
  async openBuffer(
    buffer: ArrayBuffer | Uint8Array,
    options?: StreamingH5Options,
  ): Promise<void> {
    // Initialize if not already done
    await this.init(options);

    const filename = options?.filenameHint || "data.h5";
    // Transfer the buffer to the worker for efficiency
    const data = buffer instanceof Uint8Array ? buffer.buffer : buffer;
    const result = await this.send("openBuffer", { buffer: data, filename });
    this._keys = (result.keys as string[]) || [];
    this._isOpen = true;
  }

  /**
   * Open an HDF5 file from a lazy {@link RangeSource} via the B-seam bridge.
   *
   * The Worker registers a custom Emscripten device whose synchronous `read`
   * blocks on `Atomics.wait` over a SharedArrayBuffer; this main thread services
   * each request by calling `readRange` and waking the Worker. Requires
   * cross-origin isolation (SharedArrayBuffer / COOP+COEP).
   */
  async openRange(
    source: RangeSource,
    options?: StreamingH5Options,
  ): Promise<void> {
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error(
        "RangeSource streaming requires SharedArrayBuffer (enable cross-origin isolation: COOP 'same-origin' + COEP 'require-corp')",
      );
    }
    await this.init(options);
    this.rangeReader = source.readRange;

    // SAB layout: [0..CONTROL_BYTES) = Int32 control (idx0=STATE, idx1=RETLEN),
    // then the data area (max single bridged read). The Worker loops for larger reads.
    const CONTROL_BYTES = 32;
    const MAX_CHUNK = 4 * 1024 * 1024;
    const sab = new SharedArrayBuffer(CONTROL_BYTES + MAX_CHUNK);
    this.rangeControl = new Int32Array(sab, 0, 8);
    this.rangeData = new Uint8Array(sab, CONTROL_BYTES);

    const filename = options?.filenameHint || "data.h5";
    const result = await this.send("openRange", {
      sab,
      size: source.size,
      filename,
      controlBytes: CONTROL_BYTES,
    });
    this._keys = (result.keys as string[]) || [];
    this._isOpen = true;
  }

  /**
   * Service a Worker byte-request: read via the app's `readRange`, copy the
   * bytes into the shared data area, then wake the (blocked) Worker. STATE is
   * stored last (release) so the Worker's `Atomics.wait` return (acquire) sees
   * the data + returned length.
   */
  private serviceRangeRequest(offset: number, length: number): void {
    const control = this.rangeControl;
    const dataArea = this.rangeData;
    const reader = this.rangeReader;
    if (!control || !dataArea || !reader) return;
    reader(offset, length)
      .then((bytes) => {
        const n = Math.min(bytes.length, dataArea.length, length);
        dataArea.set(bytes.subarray(0, n), 0);
        Atomics.store(control, 1, n); // RETLEN
        Atomics.store(control, 0, 2); // STATE = READY
        Atomics.notify(control, 0);
      })
      .catch((err) => {
        // Signal 0 bytes: the Worker treats it as a short read / EOF and h5wasm
        // surfaces a clean read error rather than hanging.
        Atomics.store(control, 1, 0);
        Atomics.store(control, 0, 2);
        Atomics.notify(control, 0);
        console.error("[StreamingH5File] readRange failed:", err);
      });
  }

  /**
   * Open an HDF5 file from any supported source.
   *
   * @param source - URL string, File, ArrayBuffer, Uint8Array, or RangeSource
   * @param options - Optional settings
   */
  async openAny(
    source: StreamingH5Source,
    options?: StreamingH5Options,
  ): Promise<void> {
    if (isRangeSource(source)) {
      return this.openRange(source, options);
    }
    if (typeof source === "string") {
      return this.open(source, options);
    }
    if (typeof File !== "undefined" && source instanceof File) {
      return this.openLocal(source, options);
    }
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      return this.openBuffer(source, options);
    }
    throw new Error("Unsupported source type for StreamingH5File");
  }

  /**
   * Whether a file is currently open.
   */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Get the root-level keys in the file.
   */
  keys(): string[] {
    return this._keys;
  }

  /**
   * Get the keys (children) at a given path.
   */
  async getKeys(path: string): Promise<string[]> {
    const result = await this.send("getKeys", { path });
    return (result.keys as string[]) || [];
  }

  /**
   * Get an attribute value.
   */
  async getAttr(path: string, name: string): Promise<unknown> {
    const result = await this.send("getAttr", { path, name });
    return (result.value as { value: unknown })?.value ?? result.value;
  }

  /**
   * Get all attributes at a path.
   */
  async getAttrs(path: string): Promise<Record<string, unknown>> {
    const result = await this.send("getAttrs", { path });
    return (result.attrs as Record<string, unknown>) || {};
  }

  /**
   * Get dataset metadata (shape, dtype) without reading values.
   */
  async getDatasetMeta(
    path: string,
  ): Promise<{ shape: number[]; dtype: string }> {
    const result = await this.send("getDatasetMeta", { path });
    const meta = result.meta as { shape: number[]; dtype: string };
    return meta;
  }

  /**
   * Read a dataset's value.
   *
   * @param path - Path to the dataset
   * @param slice - Optional slice specification (array of [start, end] pairs)
   */
  async getDatasetValue(
    path: string,
    slice?: Array<[number, number] | []>,
  ): Promise<{ value: unknown; shape: number[]; dtype: string }> {
    const result = await this.send("getDatasetValue", { path, slice });
    const data = result.data as {
      value: unknown;
      shape: number[];
      dtype: string;
    };
    return {
      value: reconstructValue(data.value),
      shape: data.shape,
      dtype: data.dtype,
    };
  }

  /**
   * Close the file and terminate the worker.
   */
  async close(): Promise<void> {
    if (this._isOpen) {
      await this.send("close");
      this._isOpen = false;
    }
    this.worker.terminate();
    this._keys = [];
  }
}

/**
 * Check if streaming via Web Worker is supported in the current environment.
 */
export function isStreamingSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined"
  );
}

/**
 * Open a remote HDF5 file with streaming support.
 *
 * @param url - URL to the HDF5 file
 * @param options - Optional settings
 * @returns A StreamingH5File instance
 */
export async function openStreamingH5(
  url: string,
  options?: StreamingH5Options,
): Promise<StreamingH5File> {
  if (!isStreamingSupported()) {
    throw new Error("Streaming HDF5 requires Web Worker support");
  }

  const file = new StreamingH5File();
  await file.open(url, options);
  return file;
}

/**
 * Open an HDF5 file from any supported source using a Web Worker.
 *
 * This is the recommended way to open HDF5 files in the browser as it
 * offloads all h5wasm operations to a Web Worker, avoiding main thread blocking.
 *
 * @param source - URL string, File object, ArrayBuffer, or Uint8Array
 * @param options - Optional settings
 * @returns A StreamingH5File instance
 *
 * @example
 * ```typescript
 * // From URL
 * const file = await openH5Worker("https://example.com/data.h5");
 *
 * // From File (file input)
 * const file = await openH5Worker(inputElement.files[0]);
 *
 * // From ArrayBuffer
 * const file = await openH5Worker(arrayBuffer);
 * ```
 */
export async function openH5Worker(
  source: StreamingH5Source,
  options?: StreamingH5Options,
): Promise<StreamingH5File> {
  if (!isStreamingSupported()) {
    throw new Error("Web Worker HDF5 access requires Worker/Blob/URL support");
  }

  const file = new StreamingH5File();
  await file.openAny(source, options);
  return file;
}
