# Contributing to sleap-io.js

## Toolchain

This project uses [**Bun**](https://bun.com) as its package manager, script
runner, and test runner. The Bun version is pinned in exactly one place — the
`packageManager` field in `package.json` (**`bun@1.3.14`**). CI reads that same
field via `setup-bun`'s `bun-version-file: package.json`, and a `preinstall`
guard fails fast if the Bun running `bun install` locally doesn't match the pin,
so local and CI never drift. There is no npm/Node fallback in the dev workflow —
the only place npm is still used is the release workflow's `npm publish` step
(npm's OIDC trusted publishing and provenance are registry features Bun's
publisher does not support).

[Install Bun](https://bun.com/docs/installation) (the pinned version), then:

```bash
bun install              # install deps from the committed bun.lock
bun run build            # bundle src/ to dist/ with tsup (ESM + d.ts)
bun run lint             # type-check only: tsc -p tsconfig.json --noEmit
bun run check            # lint + format check with Biome (no writes)
bun run format           # apply Biome formatting + safe lint fixes
bun test                 # run the unit suite (tests/)
bun run test:coverage    # run the suite and write coverage/lcov.info
bun run check:pack       # validate the publishable tarball (publint + attw)
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

### Linting & formatting

[**Biome**](https://biomejs.dev) is the linter/formatter (config in `biome.json`,
scoped to `src/` and `tests/`, version pinned **exactly** in `package.json` so
local and CI never drift on rules or formatting). `bun run check` is the read-only
gate CI runs (lint + formatting); `bun run format` applies Biome's formatting and
safe lint fixes. The formatter uses 2-space indent, 80-column width, double
quotes, semicolons, and trailing commas. Two recommended lint rules are disabled
because they fight intentional patterns in this parsing-heavy codebase:
`noExplicitAny` (untyped HDF5/JSON payloads) and `noNonNullAssertion`. Biome also
reports a number of pre-existing warnings (e.g. unused imports, `noGlobalIsNan`);
these are non-blocking and fine to clean up incrementally — note `noGlobalIsNan`
is **not** auto-fixed because `isNaN` and `Number.isNaN` differ in coercion
semantics.

The whole `src/` + `tests/` tree was reformatted in one commit when the formatter
was enabled; that commit is listed in `.git-blame-ignore-revs` so `git blame`
skips it (configure once with `git config blame.ignoreRevsFile
.git-blame-ignore-revs`).

### Publishable-package check

`bun run check:pack` runs [`publint`](https://publint.dev) and
[`@arethetypeswrong/cli`](https://arethetypes.wrong) against the built `dist/` to
catch broken `exports`/`types` conditions or accidental `bun:`/Node-only imports
before they reach consumers. It uses the `esm-only` attw profile (the package is
intentionally ESM-only, so the CJS/`node10` resolutions are expected and
ignored). Run `bun run build` first.

## Tests

The suite lives in `tests/**/*.test.ts` and runs on Bun's native test runner.

- **`bun test --parallel ./tests/`** is the configured `test` script. The
  explicit `./tests/` path scopes discovery to the suite so stray `*.test.ts` /
  `*.spec.ts` files elsewhere in a working tree (e.g. a local `scratch/`) aren't
  picked up. `--parallel` runs each test file in its own worker process
  (implying `--isolate`). That process
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
2. Make sure `bun run lint`, `bun run check`, `bun run build`, `bun test`, and
   `bun run check:pack` all pass.
3. Open a PR. CI runs lint, the Biome check, build, the package check, and the
   coverage suite (lint/build/coverage on both Ubuntu and Windows) with the Bun
   version pinned in `packageManager`.
