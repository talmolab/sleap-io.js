import { Video } from "./video.js";

export class SuggestionFrame {
  video: Video;
  frameIdx: number;
  metadata: Record<string, unknown>;

  constructor(options: { video: Video; frameIdx: number; metadata?: Record<string, unknown> }) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.metadata = options.metadata ?? {};
  }
}
