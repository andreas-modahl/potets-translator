import { align } from './align.js';
import type { Lesson } from './lesson.js';

export const MAX_SUBTITLE_BYTES = 100 * 1024 * 1024;
export const MAX_SUBTITLE_MS = 10 * 60 * 1000;
export interface TimedWord { text: string; start: number; end: number }
export interface SubtitlePhrase { text: string; words: TimedWord[] }
export interface SubtitleCue { start: number; end: number; text: string; turkish: string; words: TimedWord[] }

export class SubtitleError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

/** Validate provider timestamps before they can become subtitle timings. */
export function transcriptPhrases(value: unknown): SubtitlePhrase[] {
  const data = value as { durationMilliseconds?: number; phrases?: Array<{ text?: string; words?: Array<{
    text?: string; offsetMilliseconds?: number; durationMilliseconds?: number;
  }> }> } | null;
  if (!data || !Number.isFinite(data.durationMilliseconds) || data.durationMilliseconds! <= 0 || data.durationMilliseconds! > MAX_SUBTITLE_MS) {
    throw new SubtitleError('Opptaket må være på høyst 10 minutter.');
  }
  if (!Array.isArray(data.phrases) || !data.phrases.length) throw new SubtitleError('Fant ingen tale i opptaket.');
  let previousEnd = 0;
  return data.phrases.map(phrase => {
    if (!Array.isArray(phrase.words) || !phrase.words.length) {
      throw new SubtitleError('Talegjenkjenningen mangler ordtider. Prøv et annet opptak.');
    }
    const words = phrase.words.map(word => {
      const start = word.offsetMilliseconds;
      const duration = word.durationMilliseconds;
      if (typeof word.text !== 'string' || !word.text.trim() || !Number.isInteger(start) ||
          !Number.isInteger(duration) || start! < previousEnd || duration! <= 0 ||
          start! + duration! > data.durationMilliseconds!) {
        throw new SubtitleError('Talegjenkjenningen ga ugyldige eller overlappende ordtider.');
      }
      previousEnd = start! + duration!;
      return { text: word.text.trim(), start: start!, end: previousEnd };
    });
    const text = words.map(word => word.text).join(' ');
    const letters = (text: string) => text.normalize('NFC').toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
    if (typeof phrase.text !== 'string' || letters(phrase.text) !== letters(text)) {
      throw new SubtitleError('Ordlisten dekker ikke hele den gjenkjente talen. Prøv igjen.');
    }
    if (text.length > 2000) throw new SubtitleError('En taledel er for lang. Prøv et kortere klipp.');
    return { text, words };
  });
}

/** Keep each Norwegian meaning chunk attached to the exact Turkish words. */
export function phraseCues(phrase: SubtitlePhrase, lesson: Lesson): SubtitleCue[] {
  const spans = align(phrase.text, lesson.chunks.map(chunk => chunk.target));
  if (!spans) throw new SubtitleError('Kunne ikke koble norsk til alle de tyrkiske ordene. Prøv igjen.');
  let at = 0;
  const words = phrase.words.map(word => {
    const span = { ...word, at, endAt: at + word.text.length };
    at = span.endAt + 1;
    return span;
  });
  const pieces = spans.map((span, index) => {
    const covered = words.filter(word => word.at < span.end && word.endAt > span.at);
    const first = covered[0];
    const last = covered.at(-1);
    // Never accept a model's split through the middle of a spoken word.
    if (!first || !last || /[\p{L}\p{N}]/u.test(phrase.text.slice(first.at, span.at)) ||
        /[\p{L}\p{N}]/u.test(phrase.text.slice(span.end, last.endAt))) {
      throw new SubtitleError('Oversettelsen delte et tyrkisk ord feil. Prøv igjen.');
    }
    const text = lesson.chunks[index]!.native.replace(/\s+/gu, ' ').trim();
    if (!text) throw new SubtitleError('En norsk betydning mangler. Prøv igjen.');
    return { start: first.start, end: last.end, text, turkish: covered.map(word => word.text).join(' '),
      words: covered.map(({ text, start, end }) => ({ text, start, end })) };
  });
  const cues: SubtitleCue[] = [];
  for (const piece of pieces) {
    const current = cues.at(-1);
    if (current && piece.start < current.end) throw new SubtitleError('Oversettelsen gjentok et tyrkisk ord.');
    // Small meaning units stay together. Break on long pauses, length or time.
    if (current && piece.start - current.end < 800 && piece.end - current.start <= 6000 &&
        current.text.length + piece.text.length + 1 <= 80) {
      current.end = piece.end;
      current.text += ' ' + piece.text;
      current.turkish += ' ' + piece.turkish;
      current.words.push(...piece.words);
    } else cues.push({ ...piece });
  }
  return cues;
}
