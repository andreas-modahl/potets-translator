import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validEmojiHint } from './subtitle-hints.js';

test('emoji hints accept ordinary, joined, flag and keycap emoji plus known suffix symbols', () => {
  for (const emoji of ['', '🐇', '🦊', '👨‍👩‍👧', '🇳🇴', '1️⃣']) {
    assert.equal(validEmojiHint({ emoji, suffixes: [{ kind: 'plural', form: '-lar' }] }), true, emoji);
  }
  assert.equal(validEmojiHint({ emoji: '', suffixes: [] }), true);
});

test('invalid hint imports cannot add arbitrary grammar categories or unbounded text', () => {
  for (const value of [null, {}, { emoji: 'hare', suffixes: [] }, { emoji: '🐇'.repeat(30), suffixes: [] },
    { emoji: '🐇', suffixes: [{ kind: '__proto__', form: '-lar' }] },
    { emoji: '🐇', suffixes: [{ kind: 'plural', form: '' }] },
    { emoji: '🐇', suffixes: [{ kind: 'plural', form: 'x'.repeat(41) }] },
    { emoji: '🐇', suffixes: Array(4).fill({ kind: 'plural', form: '-lar' }) },
    { emoji: '🐇', suffixes: null }]) assert.equal(validEmojiHint(value), false);
});
