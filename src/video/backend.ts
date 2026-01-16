export type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;

export interface VideoBackend {
  filename: string | string[];
  shape?: [number, number, number, number];
  fps?: number;
  dataset?: string | null;
  getFrame(frameIndex: number): Promise<VideoFrame | null>;
  getFrameTimes?(): Promise<number[] | null>;
  close(): void;
}
