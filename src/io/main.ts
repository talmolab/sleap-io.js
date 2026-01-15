import { Labels } from "../model/labels.js";
import { Video } from "../model/video.js";
import { readSlp } from "../codecs/slp/read.js";
import { writeSlp } from "../codecs/slp/write.js";
import { createVideoBackend } from "../video/factory.js";
import { OpenH5Options, SlpSource } from "../codecs/slp/h5.js";

export async function loadSlp(
  source: SlpSource,
  options?: { openVideos?: boolean; h5?: OpenH5Options }
): Promise<Labels> {
  return readSlp(source, { openVideos: options?.openVideos ?? true, h5: options?.h5 });
}

export async function saveSlp(
  labels: Labels,
  filename: string,
  options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
  }
): Promise<void> {
  await writeSlp(filename, labels, {
    embed: options?.embed ?? false,
    restoreOriginalVideos: options?.restoreOriginalVideos ?? true,
  });
}

export async function loadVideo(filename: string, options?: { dataset?: string; openBackend?: boolean }): Promise<Video> {
  const backend = await createVideoBackend(filename, { dataset: options?.dataset });
  return new Video({ filename, backend, openBackend: options?.openBackend ?? true });
}
