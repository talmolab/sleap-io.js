/**
 * The sleap-io requirement that the Python cross-checks install with
 * `uv run --with`. CI sets `SLEAP_IO_REQUIREMENT` to pin the version the
 * tests run against (for example `sleap-io==0.9.5`, or a git reference to a
 * release branch); when it is unset, uv resolves the latest release.
 */
export const SLEAP_IO_REQUIREMENT: string =
  process.env.SLEAP_IO_REQUIREMENT || "sleap-io";
