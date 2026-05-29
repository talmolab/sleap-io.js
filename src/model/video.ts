import { VideoBackend, VideoFrame } from "../video/backend.js";

export class Video {
  filename: string | string[];
  backend: VideoBackend | null;
  backendMetadata: Record<string, unknown>;
  sourceVideo: Video | null;
  openBackend: boolean;
  private _embedded: boolean;
  private _shape: [number, number, number, number] | null = null;
  private _fps: number | null = null;

  constructor(options: {
    filename: string | string[];
    backend?: VideoBackend | null;
    backendMetadata?: Record<string, unknown>;
    sourceVideo?: Video | null;
    openBackend?: boolean;
    embedded?: boolean;
  }) {
    this.filename = options.filename;
    this.backend = options.backend ?? null;
    this.backendMetadata = options.backendMetadata ?? {};
    this.sourceVideo = options.sourceVideo ?? null;
    this.openBackend = options.openBackend ?? true;
    this._embedded = options.embedded ?? false;
  }

  get hasEmbeddedImages(): boolean {
    return this._embedded;
  }

  get originalVideo(): Video | null {
    if (!this.sourceVideo) return null;
    let current = this.sourceVideo;
    while (current.sourceVideo) {
      current = current.sourceVideo;
    }
    return current;
  }

  get shape(): [number, number, number, number] | null {
    return this._shape ?? this.backend?.shape ?? (this.backendMetadata.shape as [number, number, number, number] | undefined) ?? null;
  }

  set shape(value: [number, number, number, number] | null) {
    this._shape = value;
  }

  get fps(): number | null {
    return this._fps ?? this.backend?.fps ?? (this.backendMetadata.fps as number | undefined) ?? null;
  }

  set fps(value: number | null) {
    this._fps = value;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (!this.backend) return null;
    return this.backend.getFrame(frameIndex);
  }

  async getFrameTimes(): Promise<number[] | null> {
    if (!this.backend?.getFrameTimes) return null;
    return this.backend.getFrameTimes();
  }

  close(): void {
    this.backend?.close();
  }

  /**
   * Check if this video has the same path as another video.
   *
   * Port of Python `Video.matches_path` (video.py:637-715). The public default
   * is kept at `strict = true` (DECISIONS D1) because every merge/match call
   * site passes `strict` explicitly, so the default is never load-bearing for
   * parity; the LOGIC below mirrors Python exactly.
   *
   * @param other - Another video to compare with.
   * @param strict - If `true`, require an exact (posix-normalized) path match.
   *   If `false`, consider videos with the same basename as matching.
   */
  matchesPath(other: Video, strict = true): boolean {
    // HDF5 backends: prioritize source_filename matching since multiple videos
    // can share the same HDF5 file path but reference different source videos.
    const selfIsHdf5 = isHdf5Video(this);
    const otherIsHdf5 = isHdf5Video(other);

    if (selfIsHdf5 && otherIsHdf5) {
      const selfSource = hdf5SourceFilename(this);
      const otherSource = hdf5SourceFilename(other);
      const selfDataset = hdf5Dataset(this);
      const otherDataset = hdf5Dataset(other);

      // If both have datasets, they must match.
      if (selfDataset !== null && otherDataset !== null) {
        if (selfDataset !== otherDataset) {
          return false; // Different datasets = different videos
        }
      }

      // If both have source_filenames, compare them.
      if (selfSource !== null && otherSource !== null) {
        if (strict) {
          return toPosix(selfSource) === toPosix(otherSource);
        }
        return basename(selfSource) === basename(otherSource);
      }

      // If only datasets available (no source_filename), they must match.
      if (selfDataset !== null && otherDataset !== null) {
        return selfDataset === otherDataset;
      }

      // Neither source_filename nor dataset available: cannot match.
      return false;
    }

    const selfIsList = Array.isArray(this.filename);
    const otherIsList = Array.isArray(other.filename);

    if (selfIsList && otherIsList) {
      // Both are image sequences.
      const selfList = this.filename as string[];
      const otherList = other.filename as string[];
      if (strict) {
        // Exact, order-sensitive list equality.
        return arraysEqual(selfList, otherList);
      }
      // Compare basenames (order-sensitive list of basenames).
      return arraysEqual(selfList.map(basename), otherList.map(basename));
    }

    if (selfIsList || otherIsList) {
      // One is an image sequence, the other a single file.
      return false;
    }

    // Both are single files.
    const selfName = this.filename as string;
    const otherName = other.filename as string;
    if (strict) {
      // Deterministic posix-string comparison (no Node `path`, no FS access:
      // the AUTO cascade's `isSameFile` handles symlink/inode resolution).
      return toPosix(selfName) === toPosix(otherName);
    }
    return basename(selfName) === basename(otherName);
  }

  /**
   * Check if this video has the same content as another video.
   *
   * Port of Python `Video.matches_content` (video.py:717-742). Compares the
   * FULL 4-tuple shape (frames, height, width, channels) and the backend type
   * name, NOT actual frame data.
   *
   * @param other - Another video to compare with.
   * @returns `true` if the videos have the same shape and backend type.
   */
  matchesContent(other: Video): boolean {
    // Compare shapes (full tuple including frames and channels).
    if (!shapeTupleEqual(this.shape, other.shape)) {
      return false;
    }

    // Compare backend presence/type.
    if (this.backend === null && other.backend === null) {
      return true;
    }
    if (this.backend === null || other.backend === null) {
      return false;
    }

    return backendTypeName(this) === backendTypeName(other);
  }

  /**
   * Check if this video has the same shape as another video.
   *
   * Port of Python `Video.matches_shape` (video.py:744-772). Compares only
   * height, width, and channels (INCLUDING channels, EXCLUDING frames).
   *
   * @param other - Another video to compare with.
   * @returns `true` if the videos have the same height, width, and channels.
   */
  matchesShape(other: Video): boolean {
    // Prefer backendMetadata["shape"] when backend is null but the key is
    // present (real key-presence check, not truthiness).
    const selfShape =
      this.backend === null && hasOwn(this.backendMetadata, "shape")
        ? (this.backendMetadata.shape as [number, number, number, number] | null | undefined)
        : this.shape;
    const otherShape =
      other.backend === null && hasOwn(other.backendMetadata, "shape")
        ? (other.backendMetadata.shape as [number, number, number, number] | null | undefined)
        : other.shape;

    if (selfShape == null || otherShape == null) {
      return false;
    }

    // Compare only height, width, channels (indices 1..3).
    return (
      selfShape.length === otherShape.length &&
      selfShape[1] === otherShape[1] &&
      selfShape[2] === otherShape[2] &&
      selfShape[3] === otherShape[3]
    );
  }

  /**
   * Check if this video has overlapping images with another video.
   *
   * Port of Python `Video.has_overlapping_images` (video.py:774-799). Only
   * meaningful for image sequences (list filenames); compares basenames.
   *
   * @param other - Another video to compare with.
   * @returns `true` if both are image sequences with at least one shared
   *   image basename, `false` otherwise.
   */
  hasOverlappingImages(other: Video): boolean {
    if (!Array.isArray(this.filename) || !Array.isArray(other.filename)) {
      return false;
    }

    const selfBasenames = new Set((this.filename as string[]).map(basename));
    for (const f of other.filename as string[]) {
      if (selfBasenames.has(basename(f))) {
        return true;
      }
    }
    return false;
  }
}

/** Final path component, splitting on BOTH "/" and "\\" (cross-platform). */
function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

/**
 * Deterministic posix-string normalization (NOT Node `path`, which is
 * OS-dependent). Converts backslashes to forward slashes, collapses repeated
 * slashes, and drops a single trailing slash (but preserves a lone root "/").
 */
function toPosix(path: string): string {
  let p = path.replace(/\\/g, "/");
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/** Element-wise, order-sensitive string array equality. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Component-wise equality of two (possibly null) 4-tuple shapes. */
function shapeTupleEqual(
  a: [number, number, number, number] | null,
  b: [number, number, number, number] | null
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Real key-presence check (a stored `null`/`undefined` still counts as present). */
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * The dataset path for an HDF5/embedded video, or `null`. Mirrors Python
 * `getattr(backend, "dataset", None)`: prefer the live backend, then the
 * persisted `backendMetadata.dataset`.
 */
function hdf5Dataset(video: Video): string | null {
  const fromBackend = video.backend?.dataset;
  if (fromBackend != null) return fromBackend;
  const fromMeta = video.backendMetadata.dataset;
  return typeof fromMeta === "string" ? fromMeta : null;
}

/**
 * JS analog of `isinstance(backend, HDF5Video)`. JS has no formal HDF5 backend
 * class; an HDF5/embedded video is signaled by the presence of a `dataset`
 * (on the backend or in backendMetadata).
 */
function isHdf5Video(video: Video): boolean {
  return hdf5Dataset(video) !== null;
}

/**
 * The source filename for an HDF5/embedded video (Python
 * `HDF5Video.source_filename`), or `null`. In JS this is the embedded source
 * video's scalar filename.
 */
function hdf5SourceFilename(video: Video): string | null {
  const fn = video.sourceVideo?.filename;
  return typeof fn === "string" ? fn : null;
}

/**
 * Backend type name for content comparison. Mirrors Python
 * `type(backend).__name__` using the JS backend class (constructor) name.
 */
function backendTypeName(video: Video): string {
  return video.backend?.constructor?.name ?? "";
}
