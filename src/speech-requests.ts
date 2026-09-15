import { setTimeout as delay } from 'node:timers/promises';
import { SubtitleError } from './subtitles.js';

export function speechRetryDelay(value: string | null, attempt: number, now = Date.now()): number {
  const seconds = value?.trim() ? Number(value) : NaN;
  const date = value && !Number.isFinite(seconds) ? Date.parse(value) : NaN;
  const specified = Number.isFinite(seconds) ? seconds * 1000 : date - now;
  return Math.max(1000, Number.isFinite(specified) ? specified : 30000 * 2 ** attempt);
}

/** All sections share one Speech request slot and one provider cooldown. */
export class SpeechRequests {
  private tail: Promise<void> = Promise.resolve();
  private nextRequest = 0;
  private blockedUntil = 0;
  constructor(private readonly now = Date.now,
    private readonly wait: (ms: number, signal: AbortSignal) => Promise<void> = async (ms, signal) => { await delay(ms, undefined, { signal }); }) {}

  async run(request: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    try {
      await previous;
      signal.throwIfAborted();
      if (this.blockedUntil > this.now()) throw this.throttled();
      for (let attempt = 0; ; attempt++) {
        if (this.nextRequest > this.now()) await this.wait(this.nextRequest - this.now(), signal);
        signal.throwIfAborted();
        const response = await request();
        this.nextRequest = this.now() + 1000;
        if (response.status !== 429) return response;
        const cooldown = speechRetryDelay(response.headers.get('retry-after'), attempt, this.now());
        await response.body?.cancel();
        this.nextRequest = this.now() + cooldown;
        if (attempt >= 4 || cooldown > 15 * 60000) {
          this.blockedUntil = this.nextRequest;
          throw this.throttled();
        }
      }
    } finally { release(); }
  }
  private throttled() {
    return new SubtitleError('Azure Speech begrenser forespørslene (429). Prøv igjen senere; vedvarende feil kan kreve kontroll av Azure-kvoten.', 429);
  }
}
