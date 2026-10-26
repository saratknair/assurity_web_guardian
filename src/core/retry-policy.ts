import type { Clock } from "./rate-limiter.js";
import { realClock } from "./rate-limiter.js";

/**
 * RetryPolicy retries transient failures up to `retries` times (Req 1.9, 12.4).
 * Total attempts never exceed retries + 1. Non-transient errors are not retried.
 * Backoff is linear in the attempt number (bounded; no stress behaviour).
 */
export class RetryPolicy {
  constructor(
    private readonly retries: number,
    private readonly baseBackoffMs = 250,
    private readonly clock: Clock = realClock,
  ) {
    if (retries < 0) throw new Error("retries must be >= 0");
  }

  async run<T>(
    fn: () => Promise<T>,
    isTransient: (e: unknown) => boolean,
  ): Promise<T> {
    let attempt = 0;
    // attempts allowed = retries + 1
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const canRetry = attempt < this.retries && isTransient(err);
        if (!canRetry) throw err;
        attempt++;
        await this.clock.sleep(this.baseBackoffMs * attempt);
      }
    }
  }
}
