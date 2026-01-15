import { VideoBackend } from "./backend.js";
import { Hdf5VideoBackend } from "./hdf5-video.js";
import { MediaVideoBackend } from "./media-video.js";
import { openH5File } from "../codecs/slp/h5.js";

export async function createVideoBackend(
  filename: string,
  options?: { dataset?: string; embedded?: boolean; frameNumbers?: number[]; format?: string; channelOrder?: string; shape?: [number, number, number, number]; fps?: number }
): Promise<VideoBackend> {
  if (options?.embedded || filename.endsWith(".slp") || filename.endsWith(".h5") || filename.endsWith(".hdf5")) {
    const { file } = await openH5File(filename);
    const datasetPath = options?.dataset ?? "";
    return new Hdf5VideoBackend({
      filename,
      file,
      datasetPath,
      frameNumbers: options?.frameNumbers,
      format: options?.format,
      channelOrder: options?.channelOrder,
      shape: options?.shape,
      fps: options?.fps,
    });
  }

  return new MediaVideoBackend(filename);
}
