export type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;

export interface VideoBackend {
  filename: string | string[];
  shape?: [number, number, number, number];
  fps?: number;
  dataset?: string | null;
  /**
   * Embedded-image (HDF5 / `pkg.slp`) backends: the source frame numbers that
   * have a stored image, in storage order. Left unset by continuous-video
   * backends (mp4 / seq / image-sequence), where every frame is decodable.
   */
  frameNumbers?: number[];
  getFrame(frameIndex: number): Promise<VideoFrame | null>;
  getFrameTimes?(): Promise<number[] | null>;
  close(): void;
}
