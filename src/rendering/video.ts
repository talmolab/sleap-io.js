// src/rendering/video.ts

import { spawn, type ChildProcess } from "child_process";
import type { Labels } from "../model/labels.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { VideoOptions } from "./types.js";
import { renderImage } from "./render.js";

/**
 * Check if ffmpeg is available in PATH.
 */
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Render video with pose overlays.
 * Requires ffmpeg to be installed and in PATH.
 *
 * @param source - Labels or array of LabeledFrames to render
 * @param outputPath - Path to save the output video
 * @param options - Video rendering options
 */
export async function renderVideo(
  source: Labels | LabeledFrame[],
  outputPath: string,
  options: VideoOptions = {}
): Promise<void> {
  // Check ffmpeg availability
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg and ensure it is in your PATH.\n" +
        "Installation: https://ffmpeg.org/download.html"
    );
  }

  // Extract labeled frames
  const frames = Array.isArray(source) ? source : source.labeledFrames;

  // Apply frame selection
  let selectedFrames = frames;
  if (options.frameInds) {
    selectedFrames = options.frameInds
      .map((i) => frames[i])
      .filter((f): f is LabeledFrame => f !== undefined);
  } else if (options.start !== undefined || options.end !== undefined) {
    const start = options.start ?? 0;
    const end = options.end ?? frames.length;
    selectedFrames = frames.slice(start, end);
  }

  if (selectedFrames.length === 0) {
    throw new Error("No frames to render");
  }

  // Get frame dimensions from first frame
  const firstImage = await renderImage(selectedFrames[0], options);
  const width = firstImage.width;
  const height = firstImage.height;

  // Build ffmpeg command
  const fps = options.fps ?? 30;
  const codec = options.codec ?? "libx264";
  const crf = options.crf ?? 25;
  const preset = options.preset ?? "superfast";

  const ffmpegArgs = [
    "-y", // Overwrite output
    "-f",
    "rawvideo", // Input format
    "-pix_fmt",
    "rgba", // Input pixel format
    "-s",
    `${width}x${height}`, // Frame size
    "-r",
    String(fps), // Frame rate
    "-i",
    "pipe:0", // Read from stdin
    "-c:v",
    codec, // Video codec
    "-pix_fmt",
    "yuv420p", // Output pixel format
  ];

  // Add codec-specific options
  if (codec === "libx264") {
    ffmpegArgs.push("-crf", String(crf), "-preset", preset);
  }

  ffmpegArgs.push(outputPath);

  // Spawn ffmpeg process
  const ffmpeg: ChildProcess = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Handle errors
  let ffmpegError: Error | null = null;
  ffmpeg.on("error", (err) => {
    ffmpegError = err;
  });

  // Optionally capture stderr for debugging
  // ffmpeg.stderr?.on("data", (data) => {
  //   console.error(data.toString());
  // });

  // Render and pipe frames
  const total = selectedFrames.length;

  for (let i = 0; i < selectedFrames.length; i++) {
    if (ffmpegError) {
      throw ffmpegError;
    }

    const frame = selectedFrames[i];
    const imageData = await renderImage(frame, options);

    // Write raw RGBA data to ffmpeg stdin
    const buffer = Buffer.from(imageData.data.buffer);

    if (!ffmpeg.stdin) {
      throw new Error("ffmpeg stdin not available");
    }

    const canWrite = ffmpeg.stdin.write(buffer);

    // Handle backpressure
    if (!canWrite) {
      await new Promise<void>((resolve) =>
        ffmpeg.stdin?.once("drain", resolve)
      );
    }

    // Progress callback
    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }

  // Close stdin and wait for ffmpeg to finish
  ffmpeg.stdin?.end();

  return new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
  });
}
