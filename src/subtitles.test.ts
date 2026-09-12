import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcriptPhrases, phraseCues, type SubtitlePhrase } from './subtitles.js';
import type { Lesson } from './lesson.js';

const phrase: SubtitlePhrase = { text: 'Yarın seninle geleceğim.', words: [
  { text: 'Yarın', start: 500, end: 900 },
  { text: 'seninle', start: 1000, end: 1600 },
  { text: 'geleceğim.', start: 1700, end: 2500 },
] };
const lesson: Lesson = { learning: 'tr', target: phrase.text, native: 'Jeg skal komme sammen med deg i morgen.', chunks: [
  { target: 'Yarın', native: 'I morgen' },
  { target: 'seninle', native: 'sammen med deg' },
  { target: 'geleceğim', native: 'skal jeg komme.' },
] };
const response = () => ({ durationMilliseconds: 3000, phrases: [{ text: phrase.text, words: phrase.words.map(word => ({
  text: word.text, offsetMilliseconds: word.start, durationMilliseconds: word.end - word.start,
})) }] });

test('Azure word timestamps and Unicode survive parsing', () => {
  assert.deepEqual(transcriptPhrases(response()), [phrase]);
});
test('reject empty, missing, invalid, overlapping and overlong transcription results', () => {
  for (const input of [null, {}, { durationMilliseconds: 5, phrases: [] },
    { durationMilliseconds: 600001, phrases: [] }, { durationMilliseconds: 100, phrases: [{}] }]) {
    assert.throws(() => transcriptPhrases(input));
  }
  for (const timing of [NaN, Infinity, -1, 5000]) {
    const data = response(); data.phrases[0]!.words[1]!.offsetMilliseconds = timing;
    assert.throws(() => transcriptPhrases(data));
  }
  const overlap = response(); overlap.phrases[0]!.words[1]!.offsetMilliseconds = 800;
  assert.throws(() => transcriptPhrases(overlap));
});
test('Norwegian follows Turkish order, preserving the real start and end', () => {
  assert.deepEqual(phraseCues(phrase, lesson), [{ start: 500, end: 2500,
    text: 'I morgen sammen med deg skal jeg komme.', turkish: phrase.text, words: phrase.words,
    chunks: lesson.chunks.map((chunk, i) => ({ text: chunk.native, start: phrase.words[i]!.start, end: phrase.words[i]!.end })) }]);
});
test('word timestamps must cover the full provider transcript despite punctuation or case differences', () => {
  const data = response();
  data.phrases[0]!.text = 'YARIN SENİNLE GELECEĞİM!';
  assert.deepEqual(transcriptPhrases(data), [phrase]);
  data.phrases[0]!.words.splice(1, 1);
  assert.throws(() => transcriptPhrases(data));
});
test('missing words, changed words, and partial Turkish word chunks are rejected', () => {
  assert.throws(() => phraseCues(phrase, { ...lesson, chunks: lesson.chunks.slice(1) }));
  assert.throws(() => phraseCues(phrase, { ...lesson, chunks: [{ target: 'Bugün', native: 'I dag' }, ...lesson.chunks.slice(1)] }));
  assert.throws(() => phraseCues(phrase, { ...lesson, chunks: [lesson.chunks[0]!,
    { target: 'senin', native: 'din' }, { target: 'le', native: 'med' }, lesson.chunks[2]!] }));
  assert.throws(() => phraseCues(phrase, { ...lesson, chunks: [] }));
});
test('long pauses split cues without fabricating times', () => {
  const paused = { ...phrase, words: phrase.words.map((word, i) => i === 2 ? { ...word, start: 3000, end: 4000 } : word) };
  const result = phraseCues(paused, lesson);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.end, 1600);
  assert.equal(result[1]!.start, 3000);
  assert.deepEqual(result.flatMap(cue => cue.words), paused.words);
});
test('a grouped Turkish expression keeps its words and timing together', () => {
  const grouped = { ...lesson, chunks: [{ target: 'Yarın seninle', native: 'I morgen sammen med deg' }, lesson.chunks[2]!] };
  const result = phraseCues(phrase, grouped);
  assert.deepEqual(result[0]!.words, phrase.words);
  assert.deepEqual(result[0]!.chunks, [
    { text: 'I morgen sammen med deg', start: 500, end: 1600 },
    { text: 'skal jeg komme.', start: 1700, end: 2500 },
  ]);
});
test('long meaning chunks are not dropped or split into invented timestamps', () => {
  const long = { ...lesson, chunks: lesson.chunks.map((chunk, i) => i === 1 ? { ...chunk, native: 'ord '.repeat(25).trim() } : chunk) };
  const result = phraseCues(phrase, long);
  assert.equal(result.length, 3);
  assert.equal(result[1]!.start, 1000);
  assert.equal(result[1]!.end, 1600);
  assert.deepEqual(result[1]!.words, [phrase.words[1]]);
});

// This module is also loaded directly by the browser, without a build step.
const { serializeSubtitles, validateCues, timestamp, mappedChunks, sentenceAt, sentencePages } = await import(
  new URL('../public/subtitles-format.js', import.meta.url).href
);
test('sentence pages reunite split cues across pauses and retain word and meaning alignment', () => {
  const paused = { ...phrase, words: phrase.words.map((word, i) => i === 2 ? { ...word, start: 3000, end: 4000 } : word) };
  const split = phraseCues(paused, lesson);
  const original = structuredClone(split);
  const next = { start: 4200, end: 4500, turkish: 'Tamam!', text: 'Greit!' };
  const pages = sentencePages([...split, next]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].turkish, phrase.text);
  assert.equal(pages[0].text, split.map(cue => cue.text).join(' '));
  assert.equal(pages[0].start, 500);
  assert.equal(pages[0].end, 4000);
  assert.deepEqual(pages[0].words, paused.words);
  assert.deepEqual(pages[0].chunks, split.flatMap(cue => cue.chunks));
  assert.equal(pages[0].words.at(-1), split[1]!.words[0]);
  assert.deepEqual(split, original);
  assert.deepEqual(sentencePages([{ ...split[0], text: 'Edited' }, split[1]])[0].chunks, []);
  assert.deepEqual(sentencePages([]), []);
});
test('single sentence playback crosses cue boundaries and advances after its endpoint', () => {
  const cues = [
    { words: [{ text: 'Yarın', start: 100, end: 300 }] },
    { words: [{ text: 'geleceğim.', start: 350, end: 900 }, { text: 'Tamam!', start: 950, end: 1300 }] },
  ];
  assert.deepEqual(sentenceAt(cues, 200), { start: 100, end: 900 });
  assert.deepEqual(sentenceAt(cues, 900), { start: 950, end: 1300 });
  assert.equal(sentenceAt(cues, 1300), undefined);
  assert.equal(sentenceAt([], 0), undefined);
  assert.deepEqual(sentenceAt([{ words: [{ text: 'Başlık', start: 0, end: 500 }, { text: 'Bir', start: 1500, end: 1800 }] }], 1000), { start: 1500, end: 1800 });
});
test('Norwegian highlighting is disabled for changed text and restored when the original returns', () => {
  const cue = phraseCues(phrase, lesson)[0]!;
  assert.deepEqual(mappedChunks(cue), cue.chunks);
  assert.deepEqual(mappedChunks({ ...cue, text: 'En annen oversettelse.' }), []);
  assert.deepEqual(mappedChunks({ ...cue, text: cue.text.replaceAll(' ', '\n') }), cue.chunks);
  assert.deepEqual(mappedChunks(undefined), []);
});
test('SRT and VTT exports have correct timestamps and retain Norwegian letters', () => {
  const cues = [{ start: 59999.6, end: 62000, text: 'Jeg hører blåbær.' }];
  assert.equal(timestamp(59999.6), '00:01:00,000');
  assert.equal(serializeSubtitles(cues, 'srt'), '1\n00:01:00,000 --> 00:01:02,000\nJeg hører blåbær.\n');
  assert.equal(serializeSubtitles(cues, 'vtt'), 'WEBVTT\n\n1\n00:01:00.000 --> 00:01:02.000\nJeg hører blåbær.\n');
});
test('edits cannot introduce empty cues, invalid timings or subtitle markup', () => {
  for (const cues of [[], [{ start: NaN, end: 5, text: 'x' }], [{ start: -1, end: 5, text: 'x' }],
    [{ start: 5, end: 4, text: 'x' }], [{ start: 0, end: 4, text: ' ' }],
    [{ start: 0, end: 5, text: 'x' }, { start: 4, end: 6, text: 'y' }]]) {
    assert.throws(() => validateCues(cues));
  }
  assert.match(serializeSubtitles([{ start: 0, end: 1000, text: '<b>æ</b> & ø\n\nny' }], 'vtt'), /&lt;b&gt;æ&lt;\/b&gt; &amp; ø ny/);
});
