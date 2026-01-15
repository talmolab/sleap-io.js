import { VideoBackend, VideoFrame } from "../video/backend.js";

export class Video {
  filename: string | string[];
  backend: VideoBackend | null;
  backendMetadata: Record<string, unknown>;
  sourceVideo: Video | null;
  openBackend: boolean;

  constructor(options: {
    filename: string | string[];
    backend?: VideoBackend | null;
    backendMetadata?: Record<string, unknown>;
    sourceVideo?: Video | null;
    openBackend?: boolean;
  }) {
    this.filename = options.filename;
    this.backend = options.backend ?? null;
    this.backendMetadata = options.backendMetadata ?? {};
    this.sourceVideo = options.sourceVideo ?? null;
    this.openBackend = options.openBackend ?? true;
  }

  get originalVideo(): Video | null {
    if (!this.sourceVideo) return null;
    let current = this.sourceVideo;
    while (current.sourceVideo) {
      current = current.sourceVideo;
    }
    return current;
  }

  get shape(): [number, number, number, number] | null {
    return this.backend?.shape ?? (this.backendMetadata.shape as [number, number, number, number] | undefined) ?? null;
  }

  get fps(): number | null {
    return this.backend?.fps ?? (this.backendMetadata.fps as number | undefined) ?? null;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (!this.backend) return null;
    return this.backend.getFrame(frameIndex);
  }

  close(): void {
    this.backend?.close();
  }

  matchesPath(other: Video, strict = true): boolean {
    if (Array.isArray(this.filename) || Array.isArray(other.filename)) {
      return JSON.stringify(this.filename) === JSON.stringify(other.filename);
    }
    if (strict) return this.filename === other.filename;
    const basenameA = this.filename.split("/").pop();
    const basenameB = other.filename.split("/").pop();
    return basenameA === basenameB;
  }
}
