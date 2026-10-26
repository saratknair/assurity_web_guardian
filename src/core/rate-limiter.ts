/**
 * RateLimiter enforces the Conservative_Request_Rate (Req 12.1, 12.2, 1.8):
 *  - at least `requestSpacingMs` between consecutive acquisitions, and
 *  - never more than `concurrency` acquisitions in flight.
 * An injectable clock + waiter keeps it deterministic under test.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export type Release = () => void;

export class RateLimiter {
  private lastStart = Number.NEGATIVE_INFINITY;
  private inFlight = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly spacingMs: number,
    private readonly concurrency: number,
    private readonly clock: Clock = realClock,
  ) {
    if (spacingMs < 0) throw new Error("spacingMs must be >= 0");
    if (concurrency < 1) throw new Error("concurrency must be >= 1");
  }

  async acquire(): Promise<Release> {
    // Wait for a concurrency slot.
    if (this.inFlight >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inFlight++;

    // Enforce minimum spacing since the previous start.
    const since = this.clock.now() - this.lastStart;
    if (since < this.spacingMs) {
      await this.clock.sleep(this.spacingMs - since);
    }
    this.lastStart = this.clock.now();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight--;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}
