import type { SubtitlePhrase } from './subtitles.js';

/** Retry long untranscribed intervals in short clips, retaining original word timings. */
export async function recoverTranscriptGaps(
  phrases: SubtitlePhrase[], duration: number,
  transcribe: (start: number, end: number) => Promise<SubtitlePhrase[]>,
): Promise<SubtitlePhrase[]> {
  const original = phrases.flatMap(phrase => phrase.words);
  const gaps: Array<{ start: number; end: number }> = [];
  let end = 0;
  for (const word of original) {
    if (word.start - end >= 8000) gaps.push({ start: end, end: word.start });
    end = word.end;
  }
  if (duration - end >= 8000) gaps.push({ start: end, end: duration });
  const recovered: SubtitlePhrase[] = [];
  for (const gap of gaps) {
    for (let start = gap.start; start < gap.end; start += 12000) {
      const stop = Math.min(start + 12000, gap.end);
      const clipStart = Math.max(0, start - 1000);
      const clipEnd = Math.min(duration, stop + 1000);
      const result = await transcribe(clipStart, clipEnd);
      const words = result.flatMap(phrase => phrase.words).map(word => ({
        ...word, start: word.start + clipStart, end: word.end + clipStart,
      })).filter(word => word.start >= gap.start && word.end <= gap.end &&
        (word.start + word.end) / 2 >= start && (word.start + word.end) / 2 < stop);
      for (const word of words) {
        const previous = recovered.at(-1);
        const last = previous?.words.at(-1);
        if (last && word.start < last.end) continue;
        if (previous && last && word.start - last.end < 800) {
          previous.words.push(word); previous.text += ' ' + word.text;
        } else recovered.push({ text: word.text, words: [word] });
      }
    }
  }
  // Original phrases may span a recovered gap. Split only those phrases so the
  // added words can be translated and rendered in chronological order.
  if (!recovered.length) return phrases;
  const all = [...original, ...recovered.flatMap(phrase => phrase.words)].sort((a, b) => a.start - b.start);
  const merged: SubtitlePhrase[] = [];
  for (const word of all) {
    const previous = merged.at(-1);
    if (previous && word.start - previous.words.at(-1)!.end < 800 && previous.words.length < 30) {
      previous.words.push(word); previous.text += ' ' + word.text;
    } else merged.push({ text: word.text, words: [word] });
  }
  return merged;
}
