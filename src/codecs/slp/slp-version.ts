/**
 * The layout an SLP save writes, and the process-wide switch for it.
 *
 * sleap-io.js reads both SLP layouts: the 2.x layout (compound pose tables,
 * which SLEAP and sleap-io < 0.10 open) and format 3.0 (every table a group of
 * columns, Python sleap-io 0.10). Every SLP writer takes a `slpVersion`
 * option:
 *
 * - `"auto"` (the default) writes the 2.x layout unless the labels need format
 *   3.0 (see `resolveSlpVersion` in `write.ts` for the rule);
 * - `"v2"` always writes the 2.x layout;
 * - `"v3"` always writes format 3.0.
 *
 * The switch ({@link setV3Defaults}, or in Node the environment variable
 * `SLEAP_IO_V3_DEFAULTS=1`) makes `"auto"` write format 3.0 for the whole
 * process, as Python sleap-io's `set_v3_defaults`. Explicit options win over
 * it.
 *
 * This module has no HDF5 dependency.
 */

/** The `slpVersion` option of every SLP writer. */
export type SlpVersion = "auto" | "v2" | "v3";

/** The layout a save writes, once `"auto"` is decided. */
export type SlpLayout = "v2" | "v3";

/** The values of {@link SlpVersion}. */
export const SLP_VERSIONS: readonly SlpVersion[] = ["auto", "v2", "v3"];

/** The environment variable that turns on the format 3.0 defaults (Node). */
export const V3_DEFAULTS_ENV = "SLEAP_IO_V3_DEFAULTS";

const TRUE_VALUES = ["1", "true", "yes", "on"];

/** Set by {@link setV3Defaults}; `null` defers to the environment variable. */
let v3Defaults: boolean | null = null;

/**
 * Turn the format 3.0 defaults on or off for this process: with them on, every
 * save with `slpVersion: "auto"` writes format 3.0. Explicit options win.
 *
 * @param enabled `true` to turn them on, `false` to turn them off, `null` to
 *   defer to the environment variable `SLEAP_IO_V3_DEFAULTS` again (Node).
 * @throws {TypeError} If `enabled` is not `true`, `false` or `null`.
 */
export function setV3Defaults(enabled: boolean | null): void {
  if (enabled !== null && typeof enabled !== "boolean") {
    throw new TypeError(
      `enabled must be true, false or null, got ${JSON.stringify(enabled)}.`,
    );
  }
  v3Defaults = enabled;
}

/**
 * Whether the format 3.0 defaults are on for this process: the value set with
 * {@link setV3Defaults}, or else, in Node, whether `SLEAP_IO_V3_DEFAULTS` is
 * `1`, `true`, `yes` or `on` (in any case).
 */
export function getV3Defaults(): boolean {
  if (v3Defaults !== null) return v3Defaults;
  const env =
    typeof process !== "undefined"
      ? (process as { env?: Record<string, string | undefined> }).env
      : undefined;
  const value = env?.[V3_DEFAULTS_ENV];
  return (
    typeof value === "string" &&
    TRUE_VALUES.includes(value.trim().toLowerCase())
  );
}

/**
 * Check a `slpVersion` option, before anything is written.
 *
 * @returns The value, `"auto"` when unset.
 * @throws {TypeError} If it is not `"auto"`, `"v2"` or `"v3"`.
 */
export function checkSlpVersion(value: unknown): SlpVersion {
  if (value === undefined) return "auto";
  if (value !== "auto" && value !== "v2" && value !== "v3") {
    throw new TypeError(
      `slpVersion must be "auto", "v2" or "v3", got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** The `format_id` of format 3.0, the layout of groups of columns. */
export const SLP_FORMAT3_ID = 3.0;
