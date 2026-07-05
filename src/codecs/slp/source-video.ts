/**
 * Reconstruction of a video's `source_video` lineage from its serialized SLP
 * form, shared by the eager ({@link ../read}) and streaming
 * ({@link ../read-streaming}) readers.
 *
 * A `source_video` is serialized as a full video dict — the same shape
 * `video_to_dict` produces — either nested inside a `videos_json` entry
 * (non-embedded videos) or as JSON in the `{group}/source_video` HDF5 group
 * (embedded videos; the authoritative location Python reads for `.pkg.slp`).
 * Historically the JS codec reconstructed it filename-only, dropping the
 * source's shape and any deeper chain, which left `_getEffectiveShape` unable to
 * resolve an embedded subset's full frame extent across a save/reload and broke
 * the embedded-subset -> restore-original matching workflow (#160).
 */
import { Video } from "../../model/video.js";
import { resolveVideoFilename } from "./parsers.js";

/**
 * Reconstruct a lineage `Video` from its serialized dict.
 *
 * The result is METADATA-ONLY: `backend` is left `null` (a lineage video's file
 * is often unavailable, and opening it is unnecessary — matching only needs its
 * recorded shape), while `backendMetadata` carries the recorded `shape` (and the
 * rest of the backend dict) so `Video.shape` and `_getEffectiveShape` resolve
 * the source's full frame extent. Recurses so a multi-level chain
 * (e.g. crop -> embedded subset -> original mp4) is preserved end to end.
 * Mirrors the `source_video` branch of Python `make_video`.
 *
 * @param dict Parsed source-video dict: `{ filename?, backend?, source_video? }`.
 * @param labelsPath Path of the `.slp` being read, used to resolve a `"."`
 *   self-reference back to the containing file.
 */
export function buildSourceVideoFromDict(
  dict: Record<string, unknown>,
  labelsPath?: string,
): Video {
  const backend = (dict.backend ?? {}) as Record<string, unknown>;
  let filename = resolveVideoFilename(backend, dict);
  let embedded = false;
  if (filename === ".") {
    embedded = true;
    filename = labelsPath ?? ".";
  }

  const nested = dict.source_video as Record<string, unknown> | undefined;
  const sourceVideo = nested
    ? buildSourceVideoFromDict(nested, labelsPath)
    : null;

  return new Video({
    filename,
    backend: null,
    // Copy so a shared parsed object is never mutated by later crop seeding etc.
    backendMetadata: { ...backend },
    sourceVideo,
    openBackend: false,
    embedded,
  });
}
