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
const { serializeSubtitles, validateCues, timestamp, mappedChunks, sentenceAt, sentencePages, naturalSegments, pauseSegments } = await import(
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
test('natural Norwegian stays with the full sentence when display cues are joined', () => {
  const first = { start: 0, end: 500, turkish: 'Yarın', text: 'I morgen', natural: 'Jeg kommer i morgen.' };
  const second = { start: 600, end: 1000, turkish: 'geleceğim.', text: 'skal jeg komme.' };
  const next = { start: 1200, end: 1700, turkish: 'Merhaba.', text: 'Hei.', natural: 'Hei.' };
  const pages = sentencePages([first, second, next]);
  assert.equal(pages[0].natural, 'Jeg kommer i morgen.');
  assert.equal(pages[1].natural, 'Hei.');
  assert.equal(first.turkish, 'Yarın');
  assert.equal(sentencePages([{ ...first, natural: undefined }, second])[0].natural, undefined);
});

test('natural phrase links preserve exact text and allow reordered, shared and unmatched meanings', () => {
  const text = 'Jeg tar den med i morgen.';
  const links = [
    { text: 'Jeg', chunks: [] }, { text: 'tar', chunks: [2] }, { text: 'den', chunks: [1] },
    { text: 'med', chunks: [2] }, { text: 'i morgen', chunks: [0, 3] },
  ];
  const segments = naturalSegments(text, links, 4);
  assert.equal(segments.map((part: { text: string }) => part.text).join(''), text);
  assert.deepEqual(segments.filter((part: { chunks: number[] }) => part.chunks.includes(2)).map((part: { text: string }) => part.text), ['tar', 'med']);
  assert.deepEqual(naturalSegments('Ja, ja.', [{ text: 'Ja', chunks: [1] }, { text: 'ja', chunks: [0] }], 2).filter((part: { chunks: number[] }) => part.chunks.length).map((part: { chunks: number[] }) => part.chunks[0]), [1, 0]);
  const reordered = naturalSegments('Skogen er stor.', [{ text: 'er', chunks: [1] }, { text: 'stor', chunks: [2] }, { text: 'Skogen', chunks: [0] }], 3);
  assert.equal(reordered.map((part: { text: string }) => part.text).join(''), 'Skogen er stor.');
  const embedded = naturalSegments('Haren var redd for reven.', [{ text: 'Haren', chunks: [0] }, { text: 'var redd for', chunks: [1] }, { text: 'reven', chunks: [2] }], 3);
  assert.equal(embedded.map((part: { text: string }) => part.text).join(''), 'Haren var redd for reven.');
});

test('unsafe or stale natural links leave the sentence unhighlighted', () => {
  for (const links of [undefined, [], [{ text: 'hei', chunks: [0] }], [{ text: 'haren', chunks: [5] }],
    [{ text: 'haren', chunks: [-1] }], [{ text: 'har', chunks: [0] }], [{ text: 'haren', chunks: ['0'] }],
    [{ text: 'haren', chunks: [] }], [{ text: 'haren', chunks: [0] }, { text: 'haren', chunks: [1] }]]) {
    assert.deepEqual(naturalSegments('haren', links, 2), []);
  }
  assert.deepEqual(naturalSegments('Denne haren', [{ text: 'haren', chunks: [0] }], 1), []);
  assert.deepEqual(naturalSegments('haren hopper', [{ text: 'haren', chunks: [0] }], 1), []);
});

test('phrase links retain group indices across split cues and shift when sentences are combined', () => {
  const a = { start: 0, end: 500, turkish: 'Yarın', text: 'i morgen', natural: 'Jeg kommer i morgen.', naturalLinks: [{ text: 'Jeg kommer', chunks: [1] }, { text: 'i morgen', chunks: [0] }], chunks: [{ text: 'i morgen' }] };
  const b = { start: 600, end: 1000, turkish: 'geleceğim.', text: 'jeg kommer', chunks: [{ text: 'jeg kommer' }] };
  const [page] = sentencePages([a, b]);
  assert.deepEqual(page.naturalLinks, a.naturalLinks);
  assert.ok(naturalSegments(page.natural, page.naturalLinks, page.chunks.length).length);
  const c = { ...b, natural: 'kommer', naturalLinks: [{ text: 'kommer', chunks: [0] }] };
  const [combined] = sentencePages([{ ...a, natural: 'I morgen', naturalLinks: [{ text: 'I morgen', chunks: [0] }] }, c]);
  assert.deepEqual(combined.naturalLinks.map((link: { chunks: number[] }) => link.chunks), [[0], [1]]);
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

test('segment pauses preserve multiword meanings and fall back to whole spoken cues after edits', () => {
  const grouped = { ...lesson, chunks: [{ target: 'Yarın seninle', native: 'I morgen sammen med deg' }, lesson.chunks[2]!] };
  const cues = phraseCues(phrase, grouped);
  assert.deepEqual(pauseSegments(cues).map((segment: { end: number }) => segment.end), [1600, 2500]);
  assert.deepEqual(pauseSegments([{ ...cues[0], text: 'Endret tekst' }]), [{ start: 500, end: 2500 }]);
  assert.deepEqual(pauseSegments([{ start: 10, end: 20, text: 'Hei' }]), [{ start: 10, end: 20 }]);
  assert.deepEqual(pauseSegments([]), []);
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
