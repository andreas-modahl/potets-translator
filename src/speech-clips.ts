import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from './config.js';
import { transcriptPhrases, type TimedWord } from './subtitles.js';

const execute = promisify(execFile);
const ffmpeg: string | null = process.env.FFMPEG_PATH || createRequire(import.meta.url)('ffmpeg-static');
const pending = new Map<string, Promise<TimedWord[]>>();
const letters = (text: string, locale: string) => text.normalize('NFC').toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]/gu, '');

/** Match the whole transcript before selecting an occurrence; never guess a cut. */
export function clipRange(sentence: string, at: number, end: number, words: TimedWord[], locale: string) {
  if (!Number.isInteger(at) || !Number.isInteger(end) || at < 0 || end <= at || end > sentence.length) return;
  const normalized = words.map(word => letters(word.text, locale));
  if (normalized.join('') !== letters(sentence, locale)) return;
  const firstOffset = letters(sentence.slice(0, at), locale).length;
  const lastOffset = letters(sentence.slice(0, end), locale).length;
  if (firstOffset === lastOffset) return;
  let offset = 0;
  let first = -1;
  let last = -1;
  normalized.forEach((word, index) => {
    if (offset === firstOffset) first = index;
    offset += word.length;
    if (offset === lastOffset) last = index;
  });
  if (first < 0 || last < first) return;
  // Include a little silence without crossing into neighbouring words.
  return {
    start: Math.max(words[first - 1]?.end ?? 0, words[first]!.start - 35),
    end: Math.min(words[last + 1]?.start ?? Infinity, words[last]!.end + 50),
  };
}

async function wordTimes(file: string, audio: Buffer, locale: string): Promise<TimedWord[]> {
  const metadata = `${file}.timings-v1.json`;
  try { return transcriptPhrases(JSON.parse(await readFile(metadata, 'utf8'))).flatMap(phrase => phrase.words); } catch {}
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'sentence.mp3');
  form.append('definition', JSON.stringify({ locales: [locale], profanityFilterMode: 'None' }));
  const response = await fetch(`https://${config.azureSpeechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.azureSpeechKey! }, body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Speech timing request failed (${response.status}).`);
  const raw = await response.json();
  const words = transcriptPhrases(raw).flatMap(phrase => phrase.words);
  await writeFile(metadata, JSON.stringify(raw));
  return words;
}

export async function sentenceWordTimes(file: string, audio: Buffer, locale: string): Promise<TimedWord[]> {
  let timings = pending.get(file);
  if (!timings) {
    timings = wordTimes(file, audio, locale);
    pending.set(file, timings);
  }
  try { return await timings; } finally { if (pending.get(file) === timings) pending.delete(file); }
}

export async function sentenceClip(file: string, audio: Buffer, sentence: string, at: number, end: number, locale: string): Promise<Buffer> {
  if (!ffmpeg) throw new Error('FFmpeg is unavailable.');
  const clipFile = `${file}.clip-v2-${at}-${end}.mp3`;
  try { return await readFile(clipFile); } catch {}
  const words = await sentenceWordTimes(file, audio, locale);
  const range = clipRange(sentence, at, end, words, locale);
  if (!range) throw new Error('Could not reliably match sentence audio to the requested word.');
  const duration = (range.end - range.start) / 1000;
  const fadeIn = Math.min(0.012, duration / 4);
  const fadeOut = Math.min(0.020, duration / 4);
  // Reset the clip clock before applying short fades, preserving consonants
  // while avoiding a sudden jump to or from a nonzero sample.
  const filter = `atrim=start=${range.start / 1000}:end=${range.end / 1000},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`;
  const result = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-af', filter,
    '-f', 'mp3', '-codec:a', 'libmp3lame', '-b:a', '48k', 'pipe:1'],
  { encoding: 'buffer', windowsHide: true, timeout: 15_000, maxBuffer: 5 * 1024 * 1024 });
  if (!result.stdout.length) throw new Error('Empty speech clip.');
  await writeFile(clipFile, result.stdout);
  return result.stdout;
}
