/**
 * Compatibility shim so the existing vitest-style unit tests run under bun's
 * native test runner (`bun test`).
 *
 * Tests import the bun:test primitives (describe/it/expect/...) and a small
 * `vi` object that maps the handful of vitest APIs the suite uses onto their
 * bun:test equivalents. This keeps the test bodies unchanged while dropping the
 * vitest/vite-node dependency, which cannot run under bun on Windows.
 *
 * The Node-side I/O setup (the h5wasm backend and the merge/matching fs
 * resolver) is registered via the `[test].preload` entries in `bunfig.toml`
 * rather than here, so this shim stays a pure test-API mapping.
 *
 * The suite runs with `bun test --parallel`, which runs each test file in its
 * own worker process (implying `--isolate`: a fresh global object and module
 * registry per file). That isolation is load-bearing:
 *
 *   - It stops the `vi.mock` (`mock.module`) module mocks made by the
 *     mediabunny/mp4box backend tests from leaking into other files. Bun's
 *     `mock.module` is process-global and cannot be undone (`mock.restore()`
 *     does not revert it), so the real-WebM integration test would otherwise
 *     pick up the mocked `mediabunny`.
 *   - It makes `vi.resetModules()` a safe no-op: each file already starts from
 *     a clean registry, and the few tests that re-import a module per case set
 *     their globals in `beforeEach` before the first dynamic `import()`, so
 *     module-level environment captures (e.g. mp4box-video.ts's
 *     `isBrowser`/`hasWebCodecs`) are evaluated correctly.
 *   - Per-worker teardown also avoids a cumulative native-module teardown crash
 *     (skia-canvas + many h5wasm instances) seen when the whole suite shares a
 *     single process under plain `--isolate`.
 */
import { mock, spyOn, jest } from "bun:test";

export {
  describe,
  it,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  setDefaultTimeout,
} from "bun:test";

/**
 * Tracks globals replaced via `vi.stubGlobal` so `vi.unstubAllGlobals` can
 * restore the original values (matching vitest's behaviour). Stores the
 * pre-stub descriptor (or `undefined` for keys that did not previously exist).
 */
const stubbedGlobals = new Map<string, PropertyDescriptor | undefined>();

/** Minimal `vi` shim covering the vitest APIs used in this repo. */
export const vi = {
  /** vitest `vi.fn` -> bun `mock`. */
  fn: (impl?: (...args: never[]) => unknown) =>
    mock(impl ?? (() => undefined)),

  /** vitest `vi.spyOn` -> bun `spyOn`. */
  spyOn,

  /** vitest `vi.mock(specifier, factory)` -> bun `mock.module`. */
  mock: (specifier: string, factory: () => unknown) =>
    mock.module(specifier, factory),

  /**
   * vitest `vi.resetModules` -> no-op under bun.
   *
   * Bun has no module-registry reset. With `--isolate` each test file already
   * gets a fresh registry, and the tests that call this set their globals
   * before the first dynamic `import()`, so the reset is unnecessary for
   * correctness. Kept as a no-op so existing test bodies need no edits.
   */
  resetModules: () => {},

  /** vitest `vi.clearAllMocks` -> bun `jest.clearAllMocks` (clears call data). */
  clearAllMocks: () => jest.clearAllMocks(),

  /** vitest `vi.restoreAllMocks` -> bun `jest.restoreAllMocks` (restores spies). */
  restoreAllMocks: () => jest.restoreAllMocks(),

  /** vitest `vi.stubGlobal` -> assignment on globalThis, remembering the prior value. */
  stubGlobal: (name: string, value: unknown) => {
    if (!stubbedGlobals.has(name)) {
      stubbedGlobals.set(
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      );
    }
    (globalThis as Record<string, unknown>)[name] = value;
  },

  /** vitest `vi.unstubAllGlobals` -> restore every value replaced by stubGlobal. */
  unstubAllGlobals: () => {
    for (const [name, descriptor] of stubbedGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[name];
      }
    }
    stubbedGlobals.clear();
  },
};
