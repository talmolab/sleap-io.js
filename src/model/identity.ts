export class Identity {
  name: string;
  color?: string;
  metadata: Record<string, unknown>;

  constructor(options?: { name?: string; color?: string; metadata?: Record<string, unknown> }) {
    this.name = options?.name ?? "";
    this.color = options?.color;
    this.metadata = options?.metadata ?? {};
  }
}
