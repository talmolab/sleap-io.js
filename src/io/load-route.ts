/**
 * The browser route of `loadSlp`: read through the streaming (Web Worker)
 * reader when that loses nothing, else signal the caller to use the
 * in-memory reader. Kept apart from `main.ts` (whose exports are public) so
 * tests can drive it with a stand-in streaming reader.
 */

import type { Labels } from "../model/labels.js";
import { SlpFormatError } from "../codecs/slp/format-check.js";
import { SlpPointSpanError } from "../codecs/slp/point-spans.js";
import {
  StreamingIncompleteError,
  type StreamingSlpOptions,
} from "../codecs/slp/read-streaming.js";
import { redactedCauseSummary } from "./remote.js";

/** The streaming reader's signature, as `readSlpStreaming` has it. */
export type StreamingReader = (
  source: string | ArrayBuffer | Uint8Array | File,
  options: StreamingSlpOptions,
) => Promise<Labels>;

/**
 * Read `source` with the streaming reader, or return `null` when the caller
 * should read it on the main thread instead:
 *
 * - in `"auto"` mode, when the file holds content the streaming reader does
 *   not read (ROIs, masks, label images, links and embeddings of detections
 *   other than instances), so `loadSlp` never loses content;
 * - in `"auto"` mode, when the worker fails for another reason.
 *
 * A file the readers refuse (`SlpFormatError`, `SlpPointSpanError`) is
 * rethrown: the main-thread reader would refuse it the same way.
 */
export async function readStreamingOrNull(
  source: string | ArrayBuffer | Uint8Array | File,
  options: StreamingSlpOptions,
  streamMode: string,
  read: StreamingReader,
): Promise<Labels | null> {
  const auto = streamMode === "auto";
  try {
    return await read(source, { ...options, failIfIncomplete: auto });
  } catch (e) {
    if (e instanceof StreamingIncompleteError) return null;
    // A bad file is not a worker failure: the main-thread reader would
    // reject it the same way, so don't read it twice.
    if (e instanceof SlpPointSpanError || e instanceof SlpFormatError) throw e;
    if (!auto) throw e;
    // Redact: the raw error can embed ?token= / userinfo (a remote URL).
    console.warn(
      "[sleap-io] Worker-based loading failed, falling back to main thread:",
      redactedCauseSummary(e),
    );
    return null;
  }
}
