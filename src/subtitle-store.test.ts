import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubtitleStore, validateSaved } from './subtitle-store.js';
const data = () => ({ title: 'Story', source: 'story.mp3', cues: [{ start: 100, end: 900, text: 'I morgen', turkish: 'Yarın',
  words: [{ start: 100, end: 900, text: 'Yarın' }], chunks: [{ start: 100, end: 900, text: 'I morgen' }] }] });

test('known words persist per owner and cannot be removed by another user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'known-words-test-'));
  const path = join(dir, 'library.db');
  let store = new SubtitleStore(path);
  const word = { word: 'kitap', variants: ['kitap', 'kitaplar'], emoji: '📚' };
  try {
    store.setKnownWord('user:alice', word);
    assert.deepEqual(store.knownWords('user:bob'), []);
    store.setKnownWord('user:bob', { word: 'kitap' }, true);
    assert.deepEqual(store.knownWords('user:alice'), [word]);
    store.close(); store = new SubtitleStore(path);
    assert.deepEqual(store.knownWords('user:alice'), [word]);
    assert.throws(() => store.setKnownWord('user:alice', { word: 'bad', variants: [42], emoji: '' }));
    store.setKnownWord('user:alice', { word: 'kitap' }, true);
    assert.deepEqual(store.knownWords('user:alice'), []);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('saved subtitles and edits survive reopening SQLite with all highlighting timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subtitle-store-test-'));
  let store = new SubtitleStore(join(dir, 'library.db'));
  try {
    const original = store.save('alice', data());
    const edited = { ...data(), title: 'My story' }; edited.cues[0]!.text = 'I morgen tidlig';
    store.save('alice', edited, original.id);
    store.close(); store = new SubtitleStore(join(dir, 'library.db'));
    assert.equal(store.list('alice').length, 1);
    assert.deepEqual(store.get('alice', original.id)?.cues, edited.cues);
    assert.equal(store.get('alice', original.id)?.title, 'My story');
    assert.deepEqual(store.list('bob'), []);
    assert.equal(store.get('bob', original.id), undefined);
    assert.throws(() => store.save('bob', data(), original.id));
    assert.equal(store.get('alice', original.id)?.title, 'My story');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('reject invalid subtitle imports before persistence', () => {
  assert.throws(() => validateSaved(null));
  assert.throws(() => validateSaved({ ...data(), title: '' }));
  assert.throws(() => validateSaved({ ...data(), cues: [] }));
  const invalid = data(); invalid.cues[0]!.words[0]!.end = NaN;
  assert.throws(() => validateSaved(invalid));
  const overlap = data(); overlap.cues.push({ ...overlap.cues[0]! });
  assert.throws(() => validateSaved(overlap));
  const reversed = data(); reversed.cues[0]!.end = 10;
  assert.throws(() => validateSaved(reversed));
  assert.deepEqual(validateSaved(data()), data());
});

test('natural Norwegian survives saving and rejects invalid imported translations', () => {
  const store = new SubtitleStore(':memory:');
  try {
    const value = { ...data(), cues: [{ ...data().cues[0]!, natural: 'I morgen.', naturalLinks: [{ text: 'I morgen', chunks: [0] }] }] };
    const saved = store.save('alice', value);
    assert.equal(store.get('alice', saved.id)?.cues[0]?.natural, 'I morgen.');
    assert.deepEqual(store.get('alice', saved.id)?.cues[0]?.naturalLinks, value.cues[0]!.naturalLinks);
    for (const naturalLinks of [null, {}, [{ text: 'I morgen', chunks: [-1] }], [{ text: '', chunks: [0] }], [{ text: 'I morgen', chunks: ['0'] }]]) {
      assert.throws(() => validateSaved({ ...value, cues: [{ ...value.cues[0], naturalLinks }] }));
    }
    for (const natural of [null, 42, {}, '', ' ', 'x'.repeat(10001)]) {
      assert.throws(() => validateSaved({ ...data(), cues: [{ ...data().cues[0], natural }] }));
    }
  } finally { store.close(); }
});

test('optional meaning and suffix hints survive saving without changing subtitle words', () => {
  const store = new SubtitleStore(':memory:');
  try {
    const value = data();
    const hint = { emoji: '🔮', suffixes: [{ kind: 'future', form: '-ecek' }] };
    const enriched = { ...value, cues: value.cues.map(cue => ({ ...cue, chunks: cue.chunks.map(chunk => ({ ...chunk, hint })) })) };
    const saved = store.save('alice', enriched);
    assert.deepEqual(store.get('alice', saved.id)?.cues[0]?.chunks[0]?.hint, hint);
    assert.equal(saved.cues[0]?.text, value.cues[0]?.text);
    assert.deepEqual(saved.cues[0]?.words, value.cues[0]?.words);
    assert.throws(() => validateSaved({ ...enriched, cues: [{ ...enriched.cues[0], chunks: [{ ...enriched.cues[0]?.chunks[0], hint: { emoji: '<img>', suffixes: [] } }] }] }));
  } finally { store.close(); }
});
