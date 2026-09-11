import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync('public/learn.js', 'utf8');
const persistence = source.slice(source.indexOf('function saveHistory()'), source.indexOf('/* The sentences so far'));
const review = source.slice(source.indexOf('function comebacks(words)'), source.indexOf('/* Steering chips'));

test('seen sentences survive 120 cards, log truncation, level reset, reload and direction switches', () => {
  const storage = new Map();
  const context = { storage };
  const setup = `let learning = 'tr', history = [];
    const keyFor = name => learning + '.' + name;
    const recall = key => storage.get(key);
    const remember = (key, value) => storage.set(key, value);
    const loadHistory = () => JSON.parse(recall(keyFor('historikk')) ?? '[]');`;
  const result = runInNewContext(`${setup}\n${persistence}
    for (let i = 0; i < 120; i++) {
      history.push({target: 'Sentence ' + i});
      history = history.slice(-100); saveHistory();
    }
    const full = seenTargets().size;
    history = []; saveHistory();
    const afterReset = seenTargets().size;
    learning = 'en'; const other = seenTargets().size;
    learning = 'tr'; [full, afterReset, other, seenTargets().has('Sentence 0')];`, context);
  assert.deepEqual(Array.from(result), [120, 120, 0, true]);
  assert.equal(runInNewContext(`${setup}\n${persistence}\nseenTargets().size`, { storage }), 120);
});

test('review gives discovery a turn, retains hints and avoids drilling recent/function words', () => {
  const words = [
    { target: 'the', pos: 'determiner' }, { target: 'cat', pos: 'noun' },
    { target: 'walk', pos: 'verb' }, { target: 'blue', pos: 'adjective' },
  ];
  const context = { words, fold: (s: string) => s.toLowerCase(),
    loadDismissed: () => ({ words: [] }), loadStruggled: () => [{ target: 'help' }],
    seenTargets: () => new Set([1, 2]), history: [{ chunks: [{ target: 'cat' }] }] };
  const result = runInNewContext(`(${review.trim()})(words)`, context);
  assert.equal(result.length, 2);
  assert.equal(result[0].target, 'help');
  assert(['walk', 'blue'].includes(result[1].target));
  const discovery = runInNewContext(`(${review.trim()})(words)`, {
    ...context, seenTargets: () => new Set([1, 2, 3]),
  });
  assert.equal(discovery.length, 1);
  assert.equal(discovery[0].target, 'help');
});
