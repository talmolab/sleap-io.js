// scripts/burn-skeleton-masks.mjs
//
// ONE-OFF tooling (NOT part of the library): synthesize segmentation masks from
// pose so the demo has something to render. For each instance it dilates the
// skeleton (edges as capsules + disks at nodes) into a binary raster, wraps it
// as a PredictedSegmentationMask (carrying the instance's track + score), and
// resaves alongside the original poses.
//
// A proper pose -> mask utility is tracked upstream in sleap-io for a future
// release; this script exists only to generate `demo-flies13-seg.slp`. It is
// intentionally kept out of `src/` and the published package.
//
// Usage (from repo root, after `bun run build`):
//   bun scripts/burn-skeleton-masks.mjs \
//     [inSlp=demo/assets/demo-flies13-preds.slp] \
//     [outSlp=demo/assets/demo-flies13-seg.slp] \
//     [mp4=demo/assets/demo-flies13-preds.mp4]

import { readFileSync } from "node:fs";
import {
  loadSlp,
  saveSlp,
  PredictedSegmentationMask,
  encodeRle,
} from "../dist/index.js";

const args = process.argv.slice(2);
const IN_SLP = args[0] ?? "demo/assets/demo-flies13-preds.slp";
const OUT_SLP = args[1] ?? "demo/assets/demo-flies13-seg.slp";
const MP4 = args[2] ?? "demo/assets/demo-flies13-preds.mp4";

/** Squared distance from point (px, py) to segment (x0,y0)-(x1,y1). */
function distSqToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x0) * dx + (py - y0) * dy) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Stamp a capsule (thick segment) of radius `r` into a full-frame raster. */
function stampCapsule(raster, H, W, x0, y0, x1, y1, r) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r));
  const rSq = r * r;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if (distSqToSegment(px, py, x0, y0, x1, y1) <= rSq) {
        raster[py * W + px] = 1;
      }
    }
  }
}

/** Build a binary fly-body raster by dilating an instance's skeleton. */
function instanceToRaster(instance, skeleton, H, W) {
  // Visible points, indexed by skeleton order.
  const pts = instance.points.map((p) =>
    p.visible && Number.isFinite(p.xy[0]) && Number.isFinite(p.xy[1])
      ? p.xy
      : null,
  );
  const visible = pts.filter(Boolean);
  if (visible.length < 2) return null;

  // Radius scales with body size so the capsule reads as a body, not a hairline.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of visible) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const radius = Math.min(18, Math.max(5, diag * 0.14));

  const raster = new Uint8Array(H * W);

  // Edges as capsules (the bulk of the body).
  for (const edge of skeleton.edges) {
    const si = skeleton.index(edge.source.name);
    const di = skeleton.index(edge.destination.name);
    const a = pts[si];
    const b = pts[di];
    if (!a || !b) continue;
    stampCapsule(raster, H, W, a[0], a[1], b[0], b[1], radius);
  }

  // Disks at every visible node so leaf/isolated nodes still contribute.
  for (const p of visible) {
    stampCapsule(raster, H, W, p[0], p[1], p[0], p[1], radius);
  }

  // Bail if nothing landed in-bounds.
  let any = false;
  for (let i = 0; i < raster.length; i++) {
    if (raster[i]) {
      any = true;
      break;
    }
  }
  return any ? raster : null;
}

/** Read frame W/H from an mp4 via mp4box (works in Node; no media backend). */
async function probeMp4Size(path) {
  const { default: MP4Box } = await import("mp4box");
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  ab.fileStart = 0;
  const file = MP4Box.createFile();
  const dims = await new Promise((resolve, reject) => {
    file.onError = reject;
    file.onReady = (info) => {
      const t = info.videoTracks?.[0];
      if (!t) return reject(new Error("No video track in mp4"));
      resolve({ W: t.video.width, H: t.video.height });
    };
    file.appendBuffer(ab);
    file.flush();
  });
  return dims;
}

async function resolveFrameSize(labels) {
  const v = labels.videos[0];
  const shape = v?.shape;
  if (shape && shape.length >= 3 && shape[1] && shape[2]) {
    return { H: shape[1], W: shape[2] };
  }
  // The .slp stores no shape for this video; probe the media file directly.
  return probeMp4Size(MP4);
}

async function main() {
  console.log(`Loading ${IN_SLP} ...`);
  const labels = await loadSlp(IN_SLP, { openVideos: false });
  const skeleton = labels.skeletons[0];
  if (!skeleton) throw new Error("No skeleton in source labels.");

  const { H, W } = await resolveFrameSize(labels);
  console.log(`Frame size: ${W}x${H}; skeleton: ${skeleton.nodes.length} nodes`);

  let maskCount = 0;
  let frameCount = 0;
  for (const frame of labels.labeledFrames) {
    let touched = false;
    for (const instance of frame.instances) {
      const raster = instanceToRaster(instance, skeleton, H, W);
      if (!raster) continue;
      const mask = new PredictedSegmentationMask({
        rleCounts: encodeRle(raster, H, W),
        height: H,
        width: W,
        score: Number.isFinite(instance.score) ? instance.score : 1,
        track: instance.track ?? null,
        instance,
        name: instance.track?.name ?? "",
        category: "fly",
        source: "skeleton-burn-in",
      });
      frame.masks.push(mask);
      maskCount++;
      touched = true;
    }
    if (touched) frameCount++;
  }

  console.log(`Burned ${maskCount} masks across ${frameCount} frames.`);
  console.log(`Saving ${OUT_SLP} ...`);
  await saveSlp(labels, OUT_SLP, { embed: false });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
