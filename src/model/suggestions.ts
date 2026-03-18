import { Video } from "./video.js";

export class SuggestionFrame {
  video: Video;
  frameIdx: number;
  group: string;
  metadata: Record<string, unknown>;

  constructor(options: { video: Video; frameIdx: number; group?: string; metadata?: Record<string, unknown> }) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.group = options.group ?? (options.metadata?.group != null ? String(options.metadata.group) : "default");
    this.metadata = options.metadata ?? {};
  }
}
