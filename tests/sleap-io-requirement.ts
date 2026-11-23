import { execFileSync } from "node:child_process";

/**
 * The sleap-io requirement that the Python cross-checks install with
 * `uv run --with`. CI sets `SLEAP_IO_REQUIREMENT` to pin the version the
 * tests run against (for example `sleap-io==0.9.5`, or a git reference to a
 * release branch); when it is unset, uv resolves the latest release.
 */
export const SLEAP_IO_REQUIREMENT: string =
  process.env.SLEAP_IO_REQUIREMENT || "sleap-io";

/** A Python interpreter that has sleap-io, and how to run it. */
export interface SleapIoPython {
  /** How the tests name this interpreter in their output. */
  label: string;
  cmd: string;
  /** Arguments that come before the script path (or `-c`). */
  args: string[];
}

/** The default route: `uv run --with "$SLEAP_IO_REQUIREMENT" python`. */
export const UV_SLEAP_IO_PYTHON: SleapIoPython = {
  label: `uv run --with ${SLEAP_IO_REQUIREMENT}`,
  cmd: "uv",
  args: ["run", "--with", SLEAP_IO_REQUIREMENT, "python"],
};

/**
 * Prints `sleap-io <version>`, plus the requested revision and commit when
 * sleap-io was installed from git.
 */
const VERSION_PY = `
import json
import importlib.metadata as md
import sleap_io
line = "sleap-io " + sleap_io.__version__
try:
    direct = md.distribution("sleap-io").read_text("direct_url.json") or "{}"
    vcs = json.loads(direct).get("vcs_info", {})
except Exception:
    vcs = {}
if vcs.get("commit_id"):
    rev = vcs.get("requested_revision") or "git"
    line += " (" + rev + " at " + vcs["commit_id"][:12] + ")"
print(line)
`;

const logged = new Set<string>();

/**
 * Logs once, per interpreter, which sleap-io version a test file's Python
 * cross-checks run against, for example
 * `[python-compat-gen] sleap-io 0.10.0 (release/0.10 at 0123456789ab), with uv run --with ...`.
 * Call it right before the first Python run, so a file whose Python tests
 * skip pays nothing. It never fails a test: if the version cannot be read, it
 * says so, and the Python run itself passes or fails.
 */
export function logSleapIoVersion(file: string, python: SleapIoPython): void {
  const key = [python.cmd, ...python.args].join("\0");
  if (logged.has(key)) return;
  logged.add(key);
  try {
    const out = execFileSync(python.cmd, [...python.args, "-c", VERSION_PY], {
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = out.trim().split("\n").pop()?.trim();
    console.log(`[${file}] ${version}, with ${python.label}`);
  } catch (e) {
    console.warn(
      `[${file}] could not read the sleap-io version (${python.label}): ${(e as Error).message}`,
    );
  }
}
