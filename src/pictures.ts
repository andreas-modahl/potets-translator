import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chars, icons, info } from '@iconify-json/fluent-emoji-flat';
import { getIconData, iconToHTML, iconToSVG, replaceIDs } from '@iconify/utils';
import { config } from './config.js';
import type { Learning } from './lesson.js';

/**
 * A small picture for a noun.
 *
 * Three sources, tried in this order:
 *
 * 1. Microsoft's Fluent Emoji, bundled with the server (MIT). The lesson model
 *    names an emoji for each noun it can, and the flat drawing of that emoji is
 *    served straight from memory as SVG. Free, instant, and it looks like a
 *    sticker.
 * 2. ARASAAC's pictograms (CC BY-NC-SA, Government of Aragón), looked up by the
 *    word itself in its own language, for nouns no emoji covers: a teacher, a
 *    meeting, a neighbour. Fetched once and kept on disk beside the speech
 *    clips; a word that has none is remembered too, so it is asked for once.
 * 3. Recraft, drawing on demand, only when switched on: each drawing costs
 *    money, and the two free sources cover nearly everything.
 */

/** Pictures are always on: the emoji set ships with the server. */
export const picturesConfigured = true;

export class PictureUnavailable extends Error {}

/** A word is letters, maybe an apostrophe or a hyphen; nothing longer than this. */
const MAX_WORD_CHARS = 40;

export const recraftEnabled = config.recraftEnabled && Boolean(config.recraftApiKey);

const PROMPT_TAIL = 'flat cartoon sticker, thick ink outline, no text, no background';

const isVector = config.recraftModel.includes('vector');

/** The page puts this in every picture URL, so a change of source or style is never served from the browser's cache. */
export const pictureFingerprint = createHash('sha256')
  .update(`fluent-emoji-flat ${info.version ?? ''}\narasaac en\n${recraftEnabled ? `${config.recraftModel}\n${config.recraftStyleId ?? ''}\n${PROMPT_TAIL}` : ''}`)
  .digest('hex')
  .slice(0, 8);

export interface Picture {
  body: Buffer;
  type: string;
}

export interface PictureRequest {
  /** The noun, in the language being learned. */
  word: string;
  /** Which language the word is in, for the pictogram lookup. */
  lang: Learning;
  /** The emoji the lesson gave for the noun, if any. */
  emoji?: string;
  /** The noun in English, for the drawing prompt. */
  hint?: string;
}

/** Only a plain word is looked up: no sentences, no punctuation, nothing that looks like a prompt. */
export function cleanWord(raw: string): string | undefined {
  const word = raw.trim().normalize('NFC');
  if (!word || word.length > MAX_WORD_CHARS) return undefined;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u.test(word)) return undefined;
  return word;
}

/**
 * The word's meaning in English, a few words at most, as a hint for the
 * drawing model. Anything odd is dropped.
 */
export function cleanHint(raw: string): string {
  const hint = raw.trim().normalize('NFC').replace(/\s+/g, ' ');
  if (!hint || hint.length > MAX_WORD_CHARS) return '';
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u.test(hint)) return '';
  return hint;
}

/* Emoji ---------------------------------------------------------------------- */

/** The icon set's key for an emoji: its code points in hex, without the presentation selector. */
export function emojiKey(emoji: string): string {
  return [...emoji]
    .map((char) => char.codePointAt(0) ?? 0)
    .filter((point) => point !== 0xfe0f)
    .map((point) => point.toString(16))
    .join('-');
}

/** The flat drawing of an emoji as an SVG, or nothing when the set has no such emoji. */
export function emojiSvg(emoji: string): string | undefined {
  const name = (chars as Record<string, string>)[emojiKey(emoji)];
  if (!name) return undefined;
  const data = getIconData(icons, name);
  if (!data) return undefined;
  const built = iconToSVG(data);
  return iconToHTML(replaceIDs(built.body), built.attributes);
}

/* ARASAAC pictograms --------------------------------------------------------- */

const ARASAAC = 'https://api.arasaac.org/v1/pictograms';
const FETCH_MS = 8000;

interface Pictogram {
  _id: number;
  keywords?: Array<{ keyword?: string }>;
}

/**
 * Picks the pictogram for a word from a search: the first whose keyword is the
 * word itself, since a search for "masa" also brings the table cloth and the
 * ping-pong table.
 */
export function bestPictogram(results: unknown, word: string): number | undefined {
  if (!Array.isArray(results)) return undefined;
  const wanted = word.toLocaleLowerCase();
  for (const entry of results as Pictogram[]) {
    if (typeof entry?._id !== 'number') continue;
    if (entry.keywords?.some((k) => k.keyword?.toLocaleLowerCase() === wanted)) return entry._id;
  }
  return undefined;
}

/** The languages the pictograms are looked up in: the learner's, and English for the gloss. */
type PictogramLang = Learning | 'en';

async function pictogramId(word: string, lang: PictogramLang): Promise<number | undefined> {
  const path = `${ARASAAC}/${lang}/search/${encodeURIComponent(word)}`;
  const response = await fetch(path, { signal: AbortSignal.timeout(FETCH_MS) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`ARASAAC search returned ${response.status}.`);
  return bestPictogram(await response.json(), word);
}

async function pictogram(word: string, lang: PictogramLang): Promise<Picture | undefined> {
  const id = await pictogramId(word, lang);
  if (id === undefined) return undefined;
  const response = await fetch(`${ARASAAC}/${id}?download=false`, { signal: AbortSignal.timeout(FETCH_MS) });
  if (!response.ok) throw new Error(`ARASAAC image returned ${response.status}.`);
  return { body: Buffer.from(await response.arrayBuffer()), type: 'image/png' };
}

/* Recraft, off unless asked for ---------------------------------------------- */

export function prompt(word: string, hint = ''): string {
  return hint ? `${word} (${hint}), ${PROMPT_TAIL}` : `${word}, ${PROMPT_TAIL}`;
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

/** With the account empty, asking again every time only fills the log. */
const CREDITS_RETRY_MS = 60 * 60 * 1000;
let outOfCreditsUntil = 0;

function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) {
    dayStamp = today;
    drawnToday = 0;
  }
  return drawnToday < config.pictureDailyCap;
}

async function draw(word: string, hint: string): Promise<Picture> {
  const body: Record<string, unknown> = {
    prompt: prompt(word, hint),
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
    if (detail.includes('not_enough_credits')) {
      outOfCreditsUntil = Date.now() + CREDITS_RETRY_MS;
      console.warn('Recraft has no API units left; not drawing for an hour.');
      throw new PictureUnavailable('No drawing credits left.');
    }
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

async function drawing(word: string, hint: string): Promise<Picture | undefined> {
  if (!recraftEnabled) return undefined;
  if (!underDailyCap()) throw new PictureUnavailable('No more drawings today.');
  if (Date.now() < outOfCreditsUntil) throw new PictureUnavailable('No drawing credits left.');
  const drawn = await slot(() => draw(word, hint));
  drawnToday += 1;
  return drawn;
}

/* The disk cache ------------------------------------------------------------- */

/**
 * What a lookup is keyed by: the word in its language, and the English gloss
 * when there is one, since the gloss is a second place the picture may come from.
 */
function lookupKey(word: string, lang: Learning, hint: string): string {
  return `${lang}\n${word.toLocaleLowerCase()}${hint ? `\n${hint.toLocaleLowerCase()}` : ''}`;
}

/** The cached file for a lookup: the type is in the extension, and a word with no picture leaves an empty ".none". */
function cachePath(key: string, extension: string): string {
  return join(config.pictureCacheDir, `${createHash('sha256').update(key).digest('hex')}.${extension}`);
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/svg+xml': 'svg' };
const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml' };

async function cached(key: string): Promise<Picture | null | undefined> {
  for (const extension of Object.keys(TYPES)) {
    try {
      return { body: await readFile(cachePath(key, extension)), type: TYPES[extension]! };
    } catch {
      // Not this one.
    }
  }
  try {
    await readFile(cachePath(key, 'none'));
    return null;
  } catch {
    return undefined;
  }
}

async function keep(key: string, found: Picture | undefined): Promise<void> {
  await mkdir(config.pictureCacheDir, { recursive: true });
  if (found) await writeFile(cachePath(key, EXTENSIONS[found.type] ?? 'png'), found.body);
  else await writeFile(cachePath(key, 'none'), '');
}

/** The same word asked for twice while it is being looked up is looked up once. */
const pending = new Map<string, Promise<Picture>>();

/** The picture for a word: an emoji at once, else a pictogram or drawing from the cache or the source. */
export async function picture(request: PictureRequest): Promise<Picture> {
  if (request.emoji) {
    const svg = emojiSvg(request.emoji);
    if (svg) return { body: Buffer.from(svg), type: 'image/svg+xml' };
  }

  const word = cleanWord(request.word);
  if (!word) throw new PictureUnavailable('Not a word that has a picture.');
  const { lang } = request;
  const hint = cleanHint(request.hint ?? '');

  const key = lookupKey(word, lang, hint);
  const known = await cached(key);
  if (known) return known;
  if (known === null) throw new PictureUnavailable('No picture for this word.');

  const running = pending.get(key);
  if (running) return running;

  // By the word first; failing that, by its English gloss, which the
  // pictogram set covers far more of than Norwegian or Turkish.
  const job = (async () => {
    const found =
      (await pictogram(word, lang)) ?? (hint ? await pictogram(hint, 'en') : undefined) ?? (await drawing(word, hint));
    await keep(key, found);
    if (!found) throw new PictureUnavailable('No picture for this word.');
    return found;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
