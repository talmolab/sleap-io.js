# Large remote fixtures for manual perf/scale testing

> **Not used in CI.** These are large real `.slp` files hosted remotely for
> manual performance and memory testing. Nothing here is downloaded or run by
> the automated test suite — the fixtures under `tests/data/` proper are the
> small ones CI uses. This file just makes the big ones findable again.

Append `/labels.slp` to each URL to download the `.slp`. All three support HTTP
`Range` + CORS, so they also work with the browser streaming reader
(`readSlpStreaming(url)`) without downloading the whole file.

| key | URL (+`/labels.slp`) | size | frames | instances | points | tracks | kind |
|-----|----------------------|-----:|-------:|----------:|-------:|-------:|------|
| `noO4hA` | https://slp.sh/noO4hA | 221 MB | 270,095 | 540,189 (pred) | 7,022,457 | 2 | predictions-only, 1 external video |
| `JWOLGi` | https://slp.sh/JWOLGi |  81 MB | 200 | 400 | 5,200 | — | `pkg.slp` (embedded images) |
| `rrR1TS` | https://slp.sh/rrR1TS | 822 MB | 642 | 1,281 | 26,901 | — | `pkg.slp` (embedded images) |

The `pkg.slp` files are large because of *embedded frame images*; their **label**
data (frames/instances/points) is small, so `loadSlp(..., { openVideos: false })`
reads only the labels and stays fast/light regardless of file size. `noO4hA` is
the real stress test: a 270k-frame predictions project (~7M points) — the
"large SLP + long video" scenario that was OOM-crashing browser tabs.

## Download

```bash
mkdir -p /tmp/slp-perf
for k in noO4hA JWOLGi rrR1TS; do
  curl -sL -o "/tmp/slp-perf/$k.slp" "https://slp.sh/$k/labels.slp"
done
```

## Minimal reproduction (bun, self-contained)

```js
// bun this after `bun run build`. Measures eager loadSlp memory + time.
import { loadSlp } from "./dist/index.js";
const file = process.argv[2];
if (typeof Bun !== "undefined") Bun.gc(true);
const b0 = process.memoryUsage();
const t0 = performance.now();
const L = await loadSlp(file, { openVideos: false });   // labels only
const peakRss = process.memoryUsage().rss;              // pre-GC ≈ peak
if (typeof Bun !== "undefined") Bun.gc(true);
const b1 = process.memoryUsage();
let inst = 0, pts = 0;
for (const f of L.labeledFrames) { inst += f.instances.length; for (const i of f.instances) pts += i.points.length; }
console.log({ frames: L.labeledFrames.length, instances: inst, points: pts,
  ms: Math.round(performance.now() - t0),
  retainedHeapMB: Math.round((b1.heapUsed - b0.heapUsed) / 1048576),
  peakRssMB: Math.round((peakRss - b0.rss) / 1048576) });
```

The full profiling/benchmark harness lives (untracked) under
`scratch/2026-07-03-perf/` on the dev machine — see `bench/measure-one.mjs`,
`bench/read-scaling.mjs`, and the `browser/` streaming harness.

## Reference results — `noO4hA` (270k-frame predictions)

Eager `loadSlp(openVideos:false)`, bun on a dev workstation. Illustrates the
`perf/slp-read-hotspots` branch (columnar HDF5 compound read + typed-array point
storage) vs `main`:

| | `main` | branch |
|---|--:|--:|
| load time | 34.5 s | **4.2 s** |
| peak RSS | 4.31 GB | **2.19 GB** |
| retained heap | 1.50 GB | 1.04 GB |

`main`'s 4.31 GB peak exceeds a browser tab's ~2–4 GB budget (the OOM crash);
the branch fits and is ~8× faster. Browser `readSlpStreaming` of the same file:
~15 s parse, ~530 MB JS heap, correct counts.

The `pkg.slp` files (`JWOLGi`, `rrR1TS`) load labels in ~0.4 s / <200 MB peak
regardless of the 81 MB / 822 MB file sizes (images not read when
`openVideos:false`).
