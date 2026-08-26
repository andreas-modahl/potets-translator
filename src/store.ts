import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ExplainMode, PostMode } from './config.js';

export interface ChannelSettings {
  /** English names of the languages every message here is translated into. */
  targets: string[];
  /**
   * Only set when someone explicitly picked a mode for this channel. Left
   * undefined otherwise, so the channel follows DEFAULT_POST_MODE and changing
   * that setting actually takes effect on existing channels.
   */
  mode?: PostMode;
  /** Same rule as `mode`: unset means follow EXPLAIN_TRANSLATIONS. */
  explain?: ExplainMode;
}

interface StoreShape {
  version: 1;
  channels: Record<string, ChannelSettings>;
}

const EMPTY: StoreShape = { version: 1, channels: {} };

/**
 * Per-channel configuration, persisted as JSON.
 *
 * Writes are serialised through a promise chain so two slash commands landing
 * in the same tick cannot interleave and lose one of the two updates.
 */
export class ChannelStore {
  private readonly path: string;
  private data: StoreShape = structuredClone(EMPTY);
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.path = resolve(filePath);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      this.data = {
        version: 1,
        channels: parsed.channels && typeof parsed.channels === 'object' ? parsed.channels : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = structuredClone(EMPTY);
        return;
      }
      throw error;
    }
  }

  get(channelId: string): ChannelSettings | undefined {
    return this.data.channels[channelId];
  }

  async set(channelId: string, settings: ChannelSettings): Promise<void> {
    this.data.channels[channelId] = settings;
    await this.flush();
  }

  async delete(channelId: string): Promise<boolean> {
    if (!(channelId in this.data.channels)) return false;
    delete this.data.channels[channelId];
    await this.flush();
    return true;
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      // Write to a sibling file and rename, so a crash mid-write cannot leave
      // a truncated config behind.
      const temp = `${this.path}.tmp`;
      await writeFile(temp, `${snapshot}\n`, 'utf8');
      await rename(temp, this.path);
    });
    return this.writeQueue;
  }
}
