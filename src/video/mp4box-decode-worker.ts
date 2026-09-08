/**
 * Off-main mp4 decode worker (scrub-proxy v2 → off-main-thread decode).
 *
 * The main thread parses the mp4 once (mp4box) and sends this worker the sample
 * table + decoder config + a serializable byte-source descriptor. The worker then
 * owns the per-seek heavy work that used to block the UI: reading sample bytes
 * (`readRange`), feeding `VideoDecoder`, and `createImageBitmap`. It streams each
 * decoded frame back to the main thread as a Transferable `ImageBitmap` (zero
 * copy); the main-thread proxy caches + blits. The worker needs NO mp4box — only
 * `VideoDecoder`/`EncodedVideoChunk`/`createImageBitmap` + a byte source, all of
 * which exist in a Worker (verified by the 2026-09-07 spike on macOS + Windows).
 *
 * Packaging follows the io idiom (`h5-worker.ts`): the worker is an inline
 * template-string turned into a Blob URL, so it bundles with the library without
 * separate file hosting and needs no bundler cooperation. The WebCodecs-free
 * helpers below are COPIES of `mp4-decode-core.ts` and MUST be kept in lockstep
 * with it (that module is the tested source of truth; this string can't import).
 *
 * @module
 */

import type {
  Mp4Sample,
  SerializableDecoderConfig,
} from "./mp4-decode-core.js";

/**
 * A structured-cloneable byte source the worker reconstructs into a `readRange`.
 * Closures can't cross `postMessage`, so desktop (Tauri) must be described by
 * primitives (the app captures the invoke key + IPC url); browser passes the Blob
 * or a ranged URL directly.
 */
export type ByteSourceDescriptor =
  | {
      /** Desktop: POST to the Tauri custom-protocol IPC url with the invoke key. */
      kind: "tauri";
      /** `convertFileSrc("plugin:sleap|read_range","ipc")` (mac ipc://, win http://ipc.localhost). */
      url: string;
      /** Includes `Tauri-Invoke-Key` (+ dummy `Tauri-Callback`/`Tauri-Error`, Content-Type). */
      headers: Record<string, string>;
      /** Absolute file path passed to `read_range`. */
      path: string;
      size: number;
    }
  | { kind: "blob"; blob: Blob; size: number }
  | { kind: "url"; url: string; headers: Record<string, string>; size: number };

/** main → worker. */
export type WorkerInMessage =
  | {
      type: "init";
      samples: Mp4Sample[];
      config: SerializableDecoderConfig;
      byteSource: ByteSourceDescriptor;
    }
  | {
      type: "decode";
      reqId: number;
      start: number;
      end: number;
      target: number;
      cacheStart: number;
      cacheEnd: number;
    }
  | { type: "abort"; reqId: number }
  | { type: "close" };

/** worker → main. */
export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "unsupported"; reason: string }
  | { type: "bitmap"; reqId: number; frame: number; bitmap: ImageBitmap }
  | { type: "decodeDone"; reqId: number; aborted: boolean }
  | { type: "decodeError"; reqId: number; message: string };

/**
 * The worker source. No `${}` interpolation or nested backticks so the outer
 * template literal passes it through verbatim. Helpers mirror `mp4-decode-core.ts`
 * (KEEP IN LOCKSTEP); the WebCodecs feed loop mirrors
 * `Mp4BoxVideoBackend.decodeRange`.
 */
export const MP4_DECODE_WORKER_CODE = `
"use strict";

var SAMPLES = null;
var CONFIG = null;
var readRange = null;
var decoder = null;
// reqIds the main thread has aborted (checked between decode batches + in output).
var abortedReqs = new Set();
// Serialize decode work: one VideoDecoder at a time, like the on-main decodeQueue.
var queue = Promise.resolve();

// --- byte source (reconstructed from the descriptor) ---
function buildReadRange(bs) {
  if (bs.kind === "blob") {
    return function (offset, length) {
      return bs.blob.slice(offset, offset + length).arrayBuffer().then(function (b) {
        return new Uint8Array(b);
      });
    };
  }
  if (bs.kind === "tauri") {
    return function (offset, length) {
      return fetch(bs.url, {
        method: "POST",
        headers: bs.headers,
        body: JSON.stringify({ path: bs.path, offset: offset, length: length }),
      }).then(function (resp) {
        if (resp.headers.get("Tauri-Response") === "error") {
          return resp.text().then(function (t) { throw new Error("read_range: " + t); });
        }
        return resp.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      });
    };
  }
  // ranged URL
  return function (offset, length) {
    var headers = Object.assign({}, bs.headers || {});
    headers.Range = "bytes=" + offset + "-" + (offset + length - 1);
    return fetch(bs.url, { headers: headers }).then(function (resp) {
      return resp.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    });
  };
}

// --- decode-core copies (KEEP IN LOCKSTEP with mp4-decode-core.ts) ---
function selectFeedSamples(samples, start, end) {
  var minDI = Infinity, maxDI = -Infinity;
  for (var i = start; i <= end; i += 1) {
    if (samples[i].decodeIndex < minDI) minDI = samples[i].decodeIndex;
    if (samples[i].decodeIndex > maxDI) maxDI = samples[i].decodeIndex;
  }
  var toFeed = [];
  for (var k = 0; k < samples.length; k += 1) {
    var s = samples[k];
    if (s.decodeIndex >= minDI && s.decodeIndex <= maxDI) {
      toFeed.push({ presentationIndex: k, sample: s });
    }
  }
  toFeed.sort(function (a, b) { return a.sample.decodeIndex - b.sample.decodeIndex; });
  return toFeed;
}

function planReadRegions(toFeed) {
  var regions = [];
  var i = 0;
  while (i < toFeed.length) {
    var first = toFeed[i].sample;
    var regionEnd = i;
    var regionBytes = first.size;
    while (regionEnd < toFeed.length - 1) {
      var cur = toFeed[regionEnd].sample;
      var next = toFeed[regionEnd + 1].sample;
      if (next.offset === cur.offset + cur.size) {
        regionEnd += 1;
        regionBytes += next.size;
      } else {
        break;
      }
    }
    var members = [];
    for (var j = i; j <= regionEnd; j += 1) {
      members.push({ decodeIndex: toFeed[j].sample.decodeIndex, size: toFeed[j].sample.size });
    }
    regions.push({ offset: first.offset, length: regionBytes, members: members });
    i = regionEnd + 1;
  }
  return regions;
}

function readSamplesByDecodeOrder(toFeed) {
  var regions = planReadRegions(toFeed);
  var results = new Map();
  var idx = 0;
  function step() {
    if (idx >= regions.length) return Promise.resolve(results);
    var region = regions[idx];
    idx += 1;
    return readRange(region.offset, region.length).then(function (buffer) {
      var view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      var off = 0;
      for (var m = 0; m < region.members.length; m += 1) {
        var member = region.members[m];
        results.set(member.decodeIndex, view.slice(off, off + member.size));
        off += member.size;
      }
      return step();
    });
  }
  return step();
}

// --- decode one range (mirrors Mp4BoxVideoBackend.decodeRange) ---
function handleDecode(msg) {
  var reqId = msg.reqId;
  if (abortedReqs.has(reqId)) {
    self.postMessage({ type: "decodeDone", reqId: reqId, aborted: true });
    abortedReqs.delete(reqId);
    return Promise.resolve();
  }
  var toFeed = selectFeedSamples(SAMPLES, msg.start, msg.end);
  return readSamplesByDecodeOrder(toFeed).then(function (dataMap) {
    if (abortedReqs.has(reqId)) {
      self.postMessage({ type: "decodeDone", reqId: reqId, aborted: true });
      return;
    }
    var timestampMap = new Map();
    for (var t = 0; t < toFeed.length; t += 1) {
      timestampMap.set(Math.round(toFeed[t].sample.timestamp), toFeed[t].presentationIndex);
    }

    if (decoder) { try { decoder.close(); } catch (e) {} }

    var decodedCount = 0;
    var resolveComplete, rejectComplete;
    var completion = new Promise(function (res, rej) { resolveComplete = res; rejectComplete = rej; });

    decoder = new VideoDecoder({
      output: function (frame) {
        var rounded = Math.round(frame.timestamp);
        var fi = timestampMap.get(rounded);
        if (fi === undefined) {
          var best = Infinity;
          timestampMap.forEach(function (idx, ts) {
            var d = Math.abs(ts - frame.timestamp);
            if (d < best) { best = d; fi = idx; }
          });
        }
        var done = function () {
          try { frame.close(); } catch (e) {}
          decodedCount += 1;
          if (decodedCount >= toFeed.length) resolveComplete();
        };
        if (fi !== undefined && fi >= msg.cacheStart && fi <= msg.cacheEnd && !abortedReqs.has(reqId)) {
          var frameIdx = fi;
          createImageBitmap(frame).then(function (bmp) {
            self.postMessage({ type: "bitmap", reqId: reqId, frame: frameIdx, bitmap: bmp }, [bmp]);
            done();
          }).catch(done);
        } else {
          done();
        }
      },
      error: function (e) {
        if (e && e.name === "AbortError") resolveComplete();
        else rejectComplete(e);
      },
    });
    decoder.configure(CONFIG);

    var BATCH = 15;
    var i = 0;
    function feedBatch() {
      if (i >= toFeed.length) return Promise.resolve();
      var slice = toFeed.slice(i, i + BATCH);
      for (var b = 0; b < slice.length; b += 1) {
        var fe = slice[b];
        var data = dataMap.get(fe.sample.decodeIndex);
        if (!data) continue;
        decoder.decode(new EncodedVideoChunk({
          type: fe.sample.isKeyframe ? "key" : "delta",
          timestamp: fe.sample.timestamp,
          duration: fe.sample.duration,
          data: data,
        }));
      }
      i += BATCH;
      if (i < toFeed.length) {
        return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
          if (abortedReqs.has(reqId)) {
            try { decoder.close(); } catch (e) {}
            return "aborted";
          }
          return feedBatch();
        });
      }
      return Promise.resolve();
    }

    return feedBatch().then(function (result) {
      if (result === "aborted") {
        self.postMessage({ type: "decodeDone", reqId: reqId, aborted: true });
        return;
      }
      return decoder.flush().then(function () {
        return completion;
      }).then(function () {
        self.postMessage({ type: "decodeDone", reqId: reqId, aborted: abortedReqs.has(reqId) });
      });
    });
  }).catch(function (e) {
    self.postMessage({ type: "decodeError", reqId: reqId, message: String((e && e.message) || e) });
  }).then(function () {
    abortedReqs.delete(reqId);
  });
}

function handleInit(msg) {
  SAMPLES = msg.samples;
  CONFIG = msg.config;
  if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined" || typeof createImageBitmap === "undefined") {
    self.postMessage({ type: "unsupported", reason: "no WebCodecs in worker" });
    return;
  }
  try {
    readRange = buildReadRange(msg.byteSource);
  } catch (e) {
    self.postMessage({ type: "unsupported", reason: "byte source: " + String((e && e.message) || e) });
    return;
  }
  var probeLen = Math.min(8, msg.byteSource.size || 8);
  Promise.resolve()
    .then(function () { return readRange(0, probeLen); })
    .then(function () { return VideoDecoder.isConfigSupported(CONFIG); })
    .then(function (support) {
      if (!support || !support.supported) {
        self.postMessage({ type: "unsupported", reason: "codec unsupported in worker" });
        return;
      }
      self.postMessage({ type: "ready" });
    })
    .catch(function (e) {
      self.postMessage({ type: "unsupported", reason: String((e && e.message) || e) });
    });
}

self.onmessage = function (ev) {
  var msg = ev.data;
  if (!msg) return;
  if (msg.type === "init") {
    handleInit(msg);
  } else if (msg.type === "decode") {
    queue = queue.then(function () { return handleDecode(msg); });
  } else if (msg.type === "abort") {
    // Handled OUTSIDE the queue so it preempts a running decode immediately.
    abortedReqs.add(msg.reqId);
  } else if (msg.type === "close") {
    try { if (decoder) decoder.close(); } catch (e) {}
    decoder = null;
    self.close();
  }
};
`;

/** Create the decode worker from the inline blob (io idiom). */
export function createDecodeWorker(): Worker {
  const blob = new Blob([MP4_DECODE_WORKER_CODE], {
    type: "application/javascript",
  });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  // The worker has its own copy of the source now; revoke to avoid leaking the
  // object URL (the running worker keeps executing after revocation).
  URL.revokeObjectURL(url);
  return worker;
}
