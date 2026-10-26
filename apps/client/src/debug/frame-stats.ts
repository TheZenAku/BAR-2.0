/** Ring buffer of recent frame times with percentile summaries. */
export class FrameStats {
  private readonly samples: Float64Array;
  private count = 0;
  private next = 0;

  constructor(capacity = 600) {
    this.samples = new Float64Array(capacity);
  }

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
  }

  summary(): FrameSummary {
    if (this.count === 0) return { frames: 0, fps: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    const s = this.samples.slice(0, this.count).sort();
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    const pct = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
    return {
      frames: s.length,
      fps: avg > 0 ? 1000 / avg : 0,
      avgMs: avg,
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      p99Ms: pct(0.99),
      maxMs: s[s.length - 1]!,
    };
  }
}

export interface FrameSummary {
  frames: number;
  fps: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}
