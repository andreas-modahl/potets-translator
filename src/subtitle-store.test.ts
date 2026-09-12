import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubtitleStore, validateSaved } from './subtitle-store.js';
const data = () => ({ title: 'Story', source: 'story.mp3', cues: [{ start: 100, end: 900, text: 'I morgen', turkish: 'Yarın',
  words: [{ start: 100, end: 900, text: 'Yarın' }], chunks: [{ start: 100, end: 900, text: 'I morgen' }] }] });
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
