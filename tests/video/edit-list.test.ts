/**
 * Issue #274: on an MP4 cut with stream copy (`ffmpeg -ss … -c copy`), the edit
 * list hides a few leading frames. ffmpeg / Python sleap-io never count them, so
 * sleap-io.js must not either.
 *
 * Fixture `tests/data/videos/edit_list_trimmed.mp4` (64x48, 30 fps, keyframe
 * every 15, 2 B-frames; each source frame's luma = 4 × its index) was made with:
 *   ffmpeg -f lavfi -i "color=c=black:s=64x48:r=30:d=2,format=gray,geq=lum='N*4',format=yuv420p" \
 *     -c:v libx264 -g 15 -bf 2 -qp 0 id.mp4
 *   ffmpeg -ss 0.55 -i id.mp4 -c copy edit_list_trimmed.mp4
 * It stores 45 samples; ffprobe -count_frames decodes 43 (2 hidden by the edit list).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countHiddenLeadingSamples,
  editListStartTime,
} from "../../src/video/edit-list.js";

const VIDEOS = resolve(__dirname, "../data/videos");
const EDIT_LIST_CLIP = resolve(VIDEOS, "edit_list_trimmed.mp4");
const PLAIN_CLIP = resolve(VIDEOS, "small_robot_3_frame.mp4");
/** `ffprobe -count_frames … nb_read_frames` for EDIT_LIST_CLIP. */
const FFMPEG_FRAME_COUNT = 43;
const STORED_SAMPLE_COUNT = 45;

/** Parse a real file with mp4box.js: the video track's elst + sorted sample cts. */
async function parseWithMp4box(path: string) {
  const mod: any = await import("mp4box");
  const MP4Box = mod.default ?? mod;
  const bytes = readFileSync(path);
  const buffer: any = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  buffer.fileStart = 0;
  const file = MP4Box.createFile();
  let info: any = null;
  file.onReady = (i: any) => {
    info = i;
  };
  file.appendBuffer(buffer);
  file.flush();
  const track = info.videoTracks[0];
  const entries = file.getTrackById(track.id)?.edts?.elst?.entries;
  const cts = file
    .getTrackSamplesInfo(track.id)
    .map((s: any) => s.cts as number)
    .sort((a: number, b: number) => a - b);
  return { entries, cts };
}

describe("edit-list helpers", () => {
  // The start of presentation is the first edit that maps media; empty edits
  // (-1, a gap) and zero-length edits hide nothing.
  it("editListStartTime picks the first edit that maps media", () => {
    expect(editListStartTime(undefined)).toBeNull();
    expect(editListStartTime([])).toBeNull();
    expect(
      editListStartTime([{ segment_duration: 100, media_time: -1 }]),
    ).toBeNull();
    expect(
      editListStartTime([
        { segment_duration: 0, media_time: 5 },
        { segment_duration: 100, media_time: -1 },
        { segment_duration: 100, media_time: 768 },
        { segment_duration: 100, media_time: 9999 },
      ]),
    ).toBe(768);
  });

  // Only samples that START before the edit are hidden — one that starts
  // before it but runs past it is still hidden (ffmpeg drops it too).
  it("countHiddenLeadingSamples counts samples before the edit start", () => {
    expect(countHiddenLeadingSamples([0, 512, 1024, 1536], 768)).toBe(2);
    expect(countHiddenLeadingSamples([0, 512, 1024], 0)).toBe(0);
    expect(countHiddenLeadingSamples([0, 512, 1024], null)).toBe(0);
    expect(countHiddenLeadingSamples([-0.05, -0.0167, 0.0167], 0)).toBe(2);
  });

  // A broken edit list that would hide every frame must not empty the video.
  it("never hides every sample", () => {
    expect(countHiddenLeadingSamples([0, 512], 5000)).toBe(0);
  });
});

describe("edit list on a real stream-copy cut (mp4box.js parse)", () => {
  // The fixture's edit list starts presentation at media time 768 (1.5 frames
  // in); the two samples before it are exactly the two ffmpeg discards.
  it("hides the same frames ffmpeg discards", async () => {
    const { entries, cts } = await parseWithMp4box(EDIT_LIST_CLIP);
    expect(cts.length).toBe(STORED_SAMPLE_COUNT);
    const hidden = countHiddenLeadingSamples(cts, editListStartTime(entries));
    expect(hidden).toBe(2);
    expect(cts.length - hidden).toBe(FFMPEG_FRAME_COUNT);
  });

  // x264 writes an edit list on every B-frame file just to cancel its decode
  // delay; that one hides nothing, so ordinary videos keep every frame.
  it("hides nothing on an ordinary encode that also has an edit list", async () => {
    const { entries, cts } = await parseWithMp4box(PLAIN_CLIP);
    expect(editListStartTime(entries)).not.toBeNull();
    expect(countHiddenLeadingSamples(cts, editListStartTime(entries))).toBe(0);
  });
});

describe("MediaBunnyVideoBackend on a stream-copy cut (real file)", () => {
  beforeEach(() => {
    (globalThis as any).createImageBitmap = async () => ({ close: vi.fn() });
  });
  afterEach(() => {
    delete (globalThis as any).createImageBitmap;
  });

  async function open(path: string, name: string) {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    return MediaBunnyVideoBackend.fromBlob(
      new Blob([readFileSync(path)]),
      name,
    );
  }

  // The bug in #274: MediaBunny listed 45 frames starting at a negative time;
  // ffmpeg shows 43, starting at t >= 0.
  it("counts frames like ffmpeg and starts at t >= 0", async () => {
    const backend = await open(EDIT_LIST_CLIP, "edit_list_trimmed.mp4");
    expect(backend.numFrames).toBe(FFMPEG_FRAME_COUNT);
    expect(backend.shape?.[0]).toBe(FFMPEG_FRAME_COUNT);
    expect(backend.hiddenLeadingFrames).toBe(2);
    const times = (await backend.getFrameTimes()) ?? [];
    expect(times.length).toBe(FFMPEG_FRAME_COUNT);
    expect(times[0]).toBeGreaterThanOrEqual(0);
    expect(times[0]).toBeCloseTo(1 / 60, 4); // half a frame after the cut
    backend.close();
  });

  // Ordinary MP4s must be untouched.
  it("reports no hidden frames on an ordinary MP4", async () => {
    const backend = await open(PLAIN_CLIP, "small_robot_3_frame.mp4");
    expect(backend.numFrames).toBe(3);
    expect(backend.hiddenLeadingFrames).toBe(0);
    backend.close();
  });
});
