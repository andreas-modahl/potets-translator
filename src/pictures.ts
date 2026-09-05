import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * A small cartoon for a noun, drawn by Recraft.
 *
 * Each word is drawn once and kept on disk, keyed by a hash of the model, the
 * style and the prompt, the way speech clips are. The vector model is the
 * default: a few kilobytes of SVG that stays crisp at any size and takes the
 * page's background. Two guards keep the bill in hand: only a few drawings are
 * asked for at once, and no more than a set number of new ones a day.
 */

export const picturesConfigured = Boolean(config.recraftApiKey);

export class PictureUnavailable extends Error {}

/** A word is letters, maybe an apostrophe or a hyphen; nothing longer than this. */
const MAX_WORD_CHARS = 40;

const PROMPT_TAIL = 'flat cartoon sticker, thick ink outline, no text, no background';

const isVector = config.recraftModel.includes('vector');

/** The page puts this in every picture URL, so a model or style change is never served from the browser's cache. */
export const pictureFingerprint = createHash('sha256')
  .update(`${config.recraftModel}\n${config.recraftStyleId ?? ''}\n${PROMPT_TAIL}`)
  .digest('hex')
  .slice(0, 8);

export interface Picture {
  body: Buffer;
  type: string;
}

/** Only a plain word is drawn: no sentences, no punctuation, nothing that looks like a prompt. */
export function cleanWord(raw: string): string | undefined {
  const word = raw.trim().normalize('NFC');
  if (!word || word.length > MAX_WORD_CHARS) return undefined;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u.test(word)) return undefined;
  return word;
}

function prompt(word: string): string {
  return `${word}, ${PROMPT_TAIL}`;
}

function cachePath(word: string): string {
  const key = createHash('sha256')
    .update(`${config.recraftModel}\n${config.recraftStyleId ?? ''}\n${prompt(word)}`)
    .digest('hex');
  return join(config.pictureCacheDir, `${key}.${isVector ? 'svg' : 'png'}`);
}

/**
 * Recraft's SVG comes with a signed manifest and a page-sized background
 * rectangle. Neither belongs on a sticker: the manifest is half the bytes,
 * and the background would sit as a pale square on the page. The fixed pixel
 * size goes too, so CSS decides how big the drawing is.
 */
export function trimSvg(svg: string): string {
  return svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .replace(/<path[^>]*\bd="M 0 0 L (\d+) 0 L \1 (\d+) L 0 \2 L 0 0 z"[^>]*\/>/, '')
    .replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
      const kept = attrs
        .replace(/\s(width|height|preserveAspectRatio|style)="[^"]*"/g, '')
        .replace(/\sxmlns:c2pa="[^"]*"/, '');
      return `<svg${kept}>`;
    });
}

/* Spending guards ----------------------------------------------------------- */

const AT_ONCE = 2;
let inFlight = 0;
const queue: Array<() => void> = [];

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
  inFlight += 1;
  try {
    return await task();
  } finally {
    inFlight -= 1;
    queue.shift()?.();
  }
}

let dayStamp = '';
let drawnToday = 0;

function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) {
    dayStamp = today;
    drawnToday = 0;
  }
  return drawnToday < config.pictureDailyCap;
}

/** The same word asked for twice while it is being drawn is drawn once. */
const pending = new Map<string, Promise<Picture>>();

async function draw(word: string): Promise<Picture> {
  const body: Record<string, unknown> = {
    prompt: prompt(word),
    model: config.recraftModel,
    size: '1024x1024',
    response_format: 'url',
  };
  if (config.recraftStyleId) body.style_id = config.recraftStyleId;

  const response = await fetch('https://external.api.recraft.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.recraftApiKey ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Recraft returned ${response.status}: ${detail || response.statusText}`);
  }
  const result = (await response.json()) as { data?: Array<{ url?: string }> };
  const url = result.data?.[0]?.url;
  if (!url) throw new Error('Recraft returned no image.');

  const image = await fetch(url);
  if (!image.ok) throw new Error(`Fetching the drawing failed with ${image.status}.`);
  if (isVector) {
    return { body: Buffer.from(trimSvg(await image.text())), type: 'image/svg+xml' };
  }
  return { body: Buffer.from(await image.arrayBuffer()), type: 'image/png' };
}

/** The drawing for a word, from the cache when it has been asked for before. */
export async function picture(raw: string): Promise<Picture> {
  if (!picturesConfigured) throw new PictureUnavailable('Pictures are not configured on this server.');
  const word = cleanWord(raw);
  if (!word) throw new PictureUnavailable('Not a word that can be drawn.');
  const type = isVector ? 'image/svg+xml' : 'image/png';

  const file = cachePath(word);
  try {
    return { body: await readFile(file), type };
  } catch {
    // Not drawn yet.
  }

  const key = file;
  const running = pending.get(key);
  if (running) return running;

  const job = (async () => {
    if (!underDailyCap()) throw new PictureUnavailable('No more drawings today.');
    const drawn = await slot(() => draw(word));
    drawnToday += 1;
    await mkdir(config.pictureCacheDir, { recursive: true });
    await writeFile(file, drawn.body);
    return drawn;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
