/**
 * Caps how many translations are in flight at once.
 *
 * A busy channel can produce messages far faster than the API answers, and
 * without a cap a burst would open one request per message simultaneously.
 * Work past the cap waits in FIFO order, so translations still appear in the
 * order the originals were sent.
 */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
