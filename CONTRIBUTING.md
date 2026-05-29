# Contributing to sleap-io.js

## Toolchain

This project uses [**Bun**](https://bun.com) as its package manager, script
runner, and test runner. The version is pinned to **`bun@1.3.14`** via the
`packageManager` field in `package.json`; please use that version locally to
match CI. There is no npm/Node fallback in the dev workflow — the only place npm
is still used is the release workflow's `npm publish` step (npm's OIDC trusted
publishing and provenance are registry features Bun's publisher does not
support).

[Install Bun](https://bun.com/docs/installation), then:

```bash
bun install              # install deps from the committed bun.lock
bun run build            # bundle src/ to dist/ with tsup (ESM + d.ts)
bun run lint             # type-check only: tsc -p tsconfig.json --noEmit
bun test                 # run the unit suite
bun run test:coverage    # run the suite and write coverage/lcov.info
```

`bun install --frozen-lockfile` (what CI runs) installs exactly what `bun.lock`
pins and fails if `package.json` and the lockfile have drifted. Commit the
updated `bun.lock` whenever you change dependencies.

### Trusted dependencies

Bun blocks lifecycle (postinstall) scripts unless a package is listed in
`trustedDependencies`. We trust `skia-canvas` (native Canvas backend for
rendering) and `esbuild` (tsup's bundler). After changing dependencies, verify
nothing new is blocked:

```bash
bun pm untrusted         # should report 0 untrusted dependencies with scripts
```

## Tests

The suite lives in `tests/**/*.test.ts` and runs on Bun's native test runner.

- **`bun test --parallel`** is the configured `test` script. `--parallel` runs
  each test file in its own worker process (implying `--isolate`). That process
  isolation is required: the mediabunny/mp4box backend tests use `mock.module`
  (via the `vi` shim), and Bun's module mocks are process-global and cannot be
  undone — without a fresh process per file they would leak into the real-WebM
  integration test. Per-worker teardown also sidesteps a cumulative
  native-module teardown crash (skia-canvas + many h5wasm instances) that occurs
  when the whole suite shares one process.
- **`tests/bun-test.ts`** is a small shim: it re-exports the `bun:test`
  primitives and a `vi` object mapping the handful of vitest APIs the suite uses
  (`vi.fn` → `mock`, `vi.spyOn` → `spyOn`, `vi.mock` → `mock.module`, etc.).
  Test files import from this shim instead of `vitest`.
- **`bunfig.toml`** preloads the Node-side I/O backends (`h5-node.ts` for the
  h5wasm HDF5 backend + SLP writer, `node-fs-resolver.ts` for the merge/matching
  fs resolver) before every test file, replacing vitest's old `setupFiles`.

### Known harmless noise

When the rendering tests run, skia-canvas's native module sometimes prints a
`Segmentation fault` / "Bun has crashed" panic **at worker teardown**, after all
tests have already passed. It does not affect the test results or the exit code
(the suite exits `0`) — it is a native-addon teardown quirk, not a test failure.

## Submitting changes

1. Branch off `main`.
2. Make sure `bun run lint`, `bun run build`, and `bun test` all pass.
3. Open a PR. CI runs lint + build + the coverage suite on both Ubuntu and
   Windows with `bun@1.3.14`.
