import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { nounEmoji, spellsWord, alreadySeen, brief, lesson, lessons } from './lesson.js';
import { client } from './claude.js';

test('full exclusions are validated while only recent sentences enter the prompt', () => {
  const request = { learning: 'en' as const, level: 'start' as const,
    avoid: Array.from({ length: 120 }, (_, i) => `Sentence ${i}.`) };
  assert(alreadySeen('  SENTENCE 0! ', request));
  assert(!alreadySeen('Sentence 120.', request));
  const prompt = brief(request);
  assert(!prompt.includes('- Sentence 0.'));
  assert(prompt.includes('- Sentence 119.'));
  assert(prompt.includes('different main verb'));
  const purposes = new Set(Array.from({ length: 6 }, (_, i) =>
    brief({ ...request, avoid: request.avoid.slice(0, i) }).split('Make this useful or memorable: ')[1]?.split('. Stay within')[0],
  ));
  assert.equal(purposes.size, 6, 'consecutive requests cycle through different communicative purposes');
});

test('generation retries a duplicate and never falls back to serving it', async () => {
  const make = (target: string) => ({ learning: 'en', target, native: 'Hei',
    chunks: [{ target, native: 'Hei', pos: 'interjection' }] });
  const request = { learning: 'en' as const, level: 'start' as const, avoid: ['Hello.'] };
  const outputs = ['HELLO!', 'Welcome!'];
  const stub = mock.method(client().messages, 'create', async () => ({
    stop_reason: 'tool_use', content: [{ type: 'tool_use', input: make(outputs.shift() ?? 'Hello.') }],
  }) as any);
  try {
    assert.equal((await lesson(request)).target, 'Welcome!');
    assert.equal(stub.mock.callCount(), 2);
    await assert.rejects(lesson(request), /no fresh usable lesson/);
    assert.equal((await lesson({ ...request, text: 'Hello.' })).target, 'Hello.', 'own sentences remain repeatable');
  } finally { stub.mock.restore(); }
});

test('batch generation rejects seen sentences and duplicates within the batch', async () => {
  const entries = ['Hello.', 'Welcome!', 'WELCOME.'].map(target => ({ target, native: 'Hei',
    chunks: [{ target, native: 'Hei', pos: 'interjection' }] }));
  const stub = mock.method(client().messages, 'stream', () => ({ finalMessage: async () => ({
    stop_reason: 'tool_use', content: [{ type: 'tool_use', input: { lessons: entries } }],
  }) }) as any);
  try {
    assert.deepEqual((await lessons({ learning: 'en', level: 'start', avoid: ['Hello.'] }, 3)).map(l => l.target), ['Welcome!']);
  } finally { stub.mock.restore(); }
});

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
