/**
 * Refuse SLP files this version of sleap-io.js cannot read.
 *
 * Every reader (in memory, lazy, streaming, lite) calls {@link checkSlpFormat}
 * right after it has the `/metadata` attributes and before it reads anything
 * else. Without the check, a file in a newer layout loads with no error and no
 * poses (issue #278), because the readers get nothing back when they ask a
 * group of column datasets for a compound table.
 *
 * Mirrors `_check_format_id` in Python sleap-io (`sleap_io/io/slp.py`). This
 * module has no HDF5 dependency, so the lite (jsfive) reader shares it.
 */

import { isUrl, redactUrl } from "../../io/remote.js";

/**
 * The first `format_id` this version of sleap-io.js cannot read. Formats 1.x
 * and 2.x store the pose tables as compound datasets. Format 3.0 (Python
 * sleap-io 0.10) stores them as groups with one dataset per column.
 */
export const SLP_FORMAT_ID_LIMIT = 3.0;

/**
 * Features that a file may list in the `required_features` attribute of
 * `/metadata` and that this version of sleap-io.js understands. A file that
 * requires anything else is refused, because reading it without understanding
 * the feature could misread it without any sign.
 */
export const SLP_SUPPORTED_FEATURES: ReadonlySet<string> = new Set<string>();

/**
 * Thrown when an SLP file is in a format this version of sleap-io.js cannot
 * read: its `format_id` is at or above {@link SLP_FORMAT_ID_LIMIT}, or its
 * `required_features` attribute lists a feature that is not in
 * {@link SLP_SUPPORTED_FEATURES}.
 *
 * The message names the file and its format and says which tool can read it.
 * `labelsPath` is the file's path or name, with URL credentials masked.
 * `formatId` is the file's `format_id` (`null` when the file has none);
 * `unsupportedFeatures` lists the required features this version doesn't know
 * (empty when the format number alone caused the refusal).
 */
export class SlpFormatError extends Error {
  readonly labelsPath: string;
  readonly formatId: number | null;
  readonly unsupportedFeatures: string[];

  constructor(options: {
    message: string;
    labelsPath: string;
    formatId: number | null;
    unsupportedFeatures?: string[];
  }) {
    super(options.message);
    this.name = "SlpFormatError";
    this.labelsPath = options.labelsPath;
    this.formatId = options.formatId;
    this.unsupportedFeatures = options.unsupportedFeatures ?? [];
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Unwrap an HDF5 attribute as the backends hand it over: h5wasm and the
 * streaming worker give `{ value }`, jsfive and some test doubles give the bare
 * value.
 */
function attrValue(attr: unknown): unknown {
  if (
    attr !== null &&
    typeof attr === "object" &&
    !Array.isArray(attr) &&
    !ArrayBuffer.isView(attr) &&
    "value" in (attr as Record<string, unknown>)
  ) {
    return (attr as { value: unknown }).value;
  }
  return attr;
}

/** One feature name as text, without the NUL padding of fixed-length strings. */
function featureName(entry: unknown): string {
  const text =
    entry instanceof Uint8Array
      ? new TextDecoder().decode(entry)
      : String(entry);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: HDF5 pads fixed-length strings with NUL
  return text.replace(/\u0000+$/, "").trim();
}

/**
 * The feature names in a `required_features` attribute. Python writes an array
 * of strings; a lone string is read as one feature.
 */
function requiredFeatures(attr: unknown): string[] {
  const value = attrValue(attr);
  if (value === undefined || value === null) return [];
  const entries =
    Array.isArray(value) ||
    (ArrayBuffer.isView(value) && !(value instanceof Uint8Array))
      ? Array.from(value as ArrayLike<unknown>)
      : [value];
  return entries.map(featureName).filter((name) => name.length > 0);
}

/** `3` → `"3.0"`, `2.8` → `"2.8"`, so the message matches how formats are named. */
function formatLabel(formatId: number): string {
  return Number.isInteger(formatId) ? formatId.toFixed(1) : String(formatId);
}

/**
 * Throw {@link SlpFormatError} if the file is in a format this version of
 * sleap-io.js cannot read. Files without a `format_id` attribute pass, as
 * before.
 *
 * @param source Path, URL or name of the SLP file. It goes into the message
 *   and the error's `labelsPath`; credentials in a URL (userinfo, token query
 *   parameters) are masked first.
 * @param metadataAttrs The attributes of the file's `/metadata` group, as any
 *   of the HDF5 backends returns them.
 */
export function checkSlpFormat(
  source: string,
  metadataAttrs: Record<string, unknown> | null | undefined,
): void {
  const attrs = metadataAttrs ?? {};
  const labelsPath = isUrl(source) ? redactUrl(source) : source;

  const rawFormatId = attrValue(attrs.format_id);
  const formatId =
    rawFormatId === undefined || rawFormatId === null
      ? null
      : Number(rawFormatId);
  if (formatId !== null && formatId >= SLP_FORMAT_ID_LIMIT) {
    const readers =
      formatId < 4.0
        ? "Python sleap-io 0.10 or newer reads this format. To open the " +
          "file here, load it there and save a copy in the 2.x layout with " +
          "`labels.save(new_path, legacy_format=True)`, or upgrade " +
          "sleap-io.js to a version that reads format 3."
        : "It was written by a newer tool than this version of sleap-io.js " +
          "knows. Open it with the tool that wrote it, or upgrade sleap-io.js.";
    throw new SlpFormatError({
      message:
        `The SLEAP labels file '${labelsPath}' is in SLP format ` +
        `${formatLabel(formatId)}, which this version of sleap-io.js cannot ` +
        `read (it reads formats below ${formatLabel(SLP_FORMAT_ID_LIMIT)}). ` +
        readers,
      labelsPath,
      formatId,
    });
  }

  const unsupported = [...new Set(requiredFeatures(attrs.required_features))]
    .filter((name) => !SLP_SUPPORTED_FEATURES.has(name))
    .sort();
  if (unsupported.length > 0) {
    throw new SlpFormatError({
      message:
        `The SLEAP labels file '${labelsPath}'` +
        (formatId !== null && !Number.isNaN(formatId)
          ? ` (SLP format ${formatLabel(formatId)})`
          : "") +
        " requires SLP features that this version of sleap-io.js does not " +
        `support (${unsupported.join(", ")}). Open it with the tool that ` +
        "wrote it, such as a recent Python sleap-io, or upgrade sleap-io.js.",
      labelsPath,
      formatId,
      unsupportedFeatures: unsupported,
    });
  }
}
