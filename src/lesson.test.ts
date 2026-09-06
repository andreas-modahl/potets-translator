import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nounEmoji, spellsWord } from './lesson.js';

test('a noun keeps one emoji, with its selectors and joins; anything else is dropped', () => {
  assert.equal(nounEmoji('🐕', 'noun'), '🐕');
  assert.equal(nounEmoji(' ☕️ ', 'noun'), '☕️');
  assert.equal(nounEmoji('🧑‍🏫', 'noun'), '🧑‍🏫');
  assert.equal(nounEmoji('👍🏽', 'noun'), '👍🏽');
  assert.equal(nounEmoji('🐕🐕', 'noun'), undefined);
  assert.equal(nounEmoji('dog', 'noun'), undefined);
  assert.equal(nounEmoji('', 'noun'), undefined);
  assert.equal(nounEmoji('🐕', 'verb'), undefined);
  assert.equal(nounEmoji(5, 'noun'), undefined);
});

test('accepts a split that spells the word', () => {
  assert.equal(spellsWord(['oku', 'yor', 'um'], 'okuyorum'), true);
});

test('accepts a root whose consonant softened before the suffix', () => {
  // gitmek -> gidiyorum: the dictionary root is "git", the word spells "gid".
  assert.equal(spellsWord(['git', 'iyor', 'um'], 'gidiyorum'), true);
  // kitap -> kitabı.
  assert.equal(spellsWord(['kitap', 'ı'], 'kitabı'), true);
});

test('ignores the hyphens and capitals a split is written with', () => {
  assert.equal(spellsWord(['Ev', 'de'], 'evde'), true);
});

test('folds a capital İ without letting it change the length', () => {
  assert.equal(spellsWord(['İstanbul', 'a'], 'İstanbula'), true);
});

test('rejects a split that leaves letters out of the word', () => {
  assert.equal(spellsWord(['oku', 'um'], 'okuyorum'), false);
});

test('rejects a split that invents letters', () => {
  assert.equal(spellsWord(['oku', 'yor', 'sun'], 'okuyorum'), false);
});

test('rejects a dictionary form given in place of the spelling', () => {
  assert.equal(spellsWord(['okumak', 'yor', 'um'], 'okuyorum'), false);
});

test('rejects an empty split', () => {
  assert.equal(spellsWord([], 'okuyorum'), false);
});
