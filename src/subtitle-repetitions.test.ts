import assert from 'node:assert/strict';
import { test } from 'node:test';

const { repetitionGroups } = await import(new URL('../public/subtitles-format.js', import.meta.url).href);
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
