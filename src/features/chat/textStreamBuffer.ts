type FlushText = (text: string) => void;

export class TextStreamBuffer {
  private queued = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finishChunkSize: number | null = null;
  private drainResolvers: Array<() => void> = [];

  constructor(
    private readonly flushText: FlushText,
    private readonly frameMs = 16,
    private readonly liveChunkSize = 48
  ) {}

  push(text: string): void {
    if (!text) return;
    this.queued += text;
    this.schedule();
  }

  finish(): Promise<void> {
    this.finishChunkSize = Math.max(this.liveChunkSize, Math.ceil(this.queued.length / 30));
    if (!this.queued && this.timer === null) return Promise.resolve();
    this.schedule();
    return new Promise((resolve) => this.drainResolvers.push(resolve));
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flushFrame(), this.frameMs);
  }

  private flushFrame(): void {
    this.timer = null;
    const chunkSize = this.finishChunkSize ?? this.liveChunkSize;
    const text = this.queued.slice(0, chunkSize);
    this.queued = this.queued.slice(text.length);
    if (text) this.flushText(text);
    if (this.queued) {
      this.schedule();
      return;
    }
    this.finishChunkSize = null;
    const resolvers = this.drainResolvers.splice(0);
    resolvers.forEach((resolve) => resolve());
  }
}
