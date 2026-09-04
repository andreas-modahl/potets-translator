import assert from 'node:assert/strict';
import { test } from 'node:test';
import { align } from './align.js';

test('walks the sentence chunk by chunk', () => {
  const spans = align('Ben okula gidiyorum', ['Ben', 'okula', 'gidiyorum']);
  assert.deepEqual(spans, [
    { at: 0, end: 3 },
    { at: 4, end: 9 },
    { at: 10, end: 19 },
  ]);
});

test('lets punctuation and spacing fall between chunks', () => {
  const spans = align('Merhaba, nasılsın?', ['Merhaba', 'nasılsın']);
  assert.deepEqual(spans, [
    { at: 0, end: 7 },
    { at: 9, end: 17 },
  ]);
});

test('keeps punctuation the model attached to a chunk, since it is really there', () => {
  const spans = align('Merhaba, nasılsın?', ['Merhaba,', 'nasılsın?']);
  assert.deepEqual(spans, [
    { at: 0, end: 8 },
    { at: 9, end: 18 },
  ]);
});

test('finds a chunk carrying punctuation the sentence does not have', () => {
  const spans = align('Merhaba nasılsın', ['"Merhaba"', 'nasılsın.']);
  assert.deepEqual(spans, [
    { at: 0, end: 7 },
    { at: 8, end: 16 },
  ]);
});

test('rejects a breakdown that skips a word', () => {
  assert.equal(align('Ben her gün okula gidiyorum', ['Ben', 'okula', 'gidiyorum']), undefined);
});

test('rejects a breakdown that stops short of the end', () => {
  assert.equal(align('Ben okula gidiyorum', ['Ben', 'okula']), undefined);
});

test('rejects a chunk that is not in the sentence at all', () => {
  assert.equal(align('Ben okula gidiyorum', ['Ben', 'eve', 'gidiyorum']), undefined);
});

test('rejects chunks given out of order', () => {
  assert.equal(align('Ben okula gidiyorum', ['okula', 'Ben', 'gidiyorum']), undefined);
});

test('does not let one chunk overlap the next', () => {
  // "gidiyor" sits inside "gidiyorum", so a second chunk claiming it would have
  // to reach back before the cursor.
  assert.equal(align('Ben gidiyorum', ['Ben', 'gidiyorum', 'gidiyor']), undefined);
});

test('matches a repeated word at its later position', () => {
  const spans = align('Çok çok güzel', ['Çok', 'çok', 'güzel']);
  assert.deepEqual(spans, [
    { at: 0, end: 3 },
    { at: 4, end: 7 },
    { at: 8, end: 13 },
  ]);
});

test('rejects an empty breakdown', () => {
  assert.equal(align('Ben okula gidiyorum', []), undefined);
});

test('rejects a blank chunk', () => {
  assert.equal(align('Ben okula gidiyorum', ['Ben', '   ', 'okula gidiyorum']), undefined);
});
