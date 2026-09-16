import assert from 'node:assert/strict';
import { test } from 'node:test';

const { repetitionGroups, topVideoWords, wordMeanings, normalizeWord } = await import(new URL('../public/subtitles-format.js', import.meta.url).href);
const word = (text: string, start: number) => ({ text, start, end: start + 100 });

test('counts past occurrences, groups observed inflections, and excludes duplicate sections and future words', () => {
  const words = [word('Kitap', 0), word('kitaplar', 200), word('kitaptan', 400), word('kitap', 900)];
  const groups = repetitionGroups([{ words }, { words: [words[1]] }], [word('kitaplar', 200)], 500);
  assert.deepEqual(groups, [{ word: 'kitap', variants: ['kitap', 'kitaplar', 'kitaptan'], count: 3 }]);
});

test('normalizes Turkish case and punctuation without merging arbitrary similar words', () => {
  const words = [word('AYNI,', 0), word('aynı', 200), word('ayna', 400), word('Ankara’ya', 600), word('Ankara', 800)];
  const groups = repetitionGroups([{ words }], words, 800);
  assert.deepEqual(groups.map((group: any) => [group.word, group.count]), [['aynı', 2], ['ayna', 1], ['ankara', 2]]);
});

test('current sentence words that have not occurred yet have zero count', () => {
  const future = word('yarın', 1000);
  assert.equal(repetitionGroups([{ words: [future] }], [future], 0)[0].count, 0);
});

test('top five uses whole-video frequencies with grouped occurrence times and meaning emojis', () => {
  const words = ['kitap', 'kitaplar', 'kitap', 'su', 'su', 'ben', 'ben', 'ev', 'ev', 'gün', 'gün', 'okul']
    .map((text, index) => word(text, index * 200));
  const groups = topVideoWords([{ words }, { words: [words[0]] }]);
  assert.equal(groups.length, 5);
  assert.equal(groups[0].word, 'kitap');
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].emoji, '📚');
  assert.deepEqual(groups[0].times, [0, 200, 400]);
  assert.equal(groups.some((group: any) => group.word === 'okul'), false);
  assert.deepEqual(topVideoWords([]), []);
});

test('known word families are excluded before filling the top five', () => {
  const words = ['kitap', 'kitaplar', 'kitap', 'su', 'ben', 'ev', 'gün', 'okul'].map((text, index) => word(text, index * 200));
  const groups = topVideoWords([{ words }], new Set(['kitaplar']));
  assert.equal(groups.length, 5);
  assert.equal(groups.some((group: any) => group.word === 'kitap'), false);
  assert.equal(groups.some((group: any) => group.word === 'okul'), true);
});

test('word meanings exclude whole phrases and deduplicate capitalization and punctuation', () => {
  const cues = [
    { words: [word('bir', 0), word('kişi', 100)], chunks: [{ start: 0, end: 200, text: 'en person' }] },
    { words: [word('bir', 300)], chunks: [{ start: 300, end: 400, text: 'en' }] },
    { words: [word('bir', 500)], chunks: [{ start: 500, end: 600, text: 'En.' }] },
  ];
  assert.deepEqual(wordMeanings(cues, ['bir']), { translations: ['en'], examples: ['bir kişi → en person'] });
  assert.deepEqual(topVideoWords(cues)[0].translations, ['en']);
  assert.equal(normalizeWord("1920'de"), '');
  assert.equal(normalizeWord('1922’de'), '');
  assert.equal(normalizeWord('de'), 'de');
});
