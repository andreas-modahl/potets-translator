import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../public/learn/speech-timing.js', import.meta.url), 'utf8');
const { speechTimeline, spokenChunk } = runInNewContext(source.replaceAll('export function', 'function') + '\n({ speechTimeline, spokenChunk });');

test('sentence ball follows repeated words and phrases using audio time', () => {
  const words = [
    { text: 'Go,', start: 100, end: 300 },
    { text: 'go', start: 400, end: 600 },
    { text: 'home.', start: 650, end: 900 },
  ];
  const timeline = speechTimeline('Go, go home.', [{ target: 'Go' }, { target: 'go home' }], words, 'en-GB');
  assert.equal(spokenChunk(timeline, 0), -1);
  assert.equal(spokenChunk(timeline, 100), 0);
  assert.equal(spokenChunk(timeline, 300), -1);
  assert.equal(spokenChunk(timeline, 450), 1);
  assert.equal(spokenChunk(timeline, 700), 1);
  assert.equal(spokenChunk(timeline, 900), -1);
  // Replaying/seeking backwards uses the current audio clock, not a timer queue.
  assert.equal(spokenChunk(timeline, 150), 0);
});

test('mismatched transcripts or chunks never point at a guessed word', () => {
  const words = [{ text: 'Go', start: 0, end: 200 }];
  assert.equal(speechTimeline('Stay', [{ target: 'Stay' }], words, 'en-GB').length, 0);
  assert.equal(speechTimeline('Go', [{ target: 'Stay' }], words, 'en-GB').length, 0);
});

test('Turkish casing and punctuation preserve timing alignment', () => {
  const timeline = speechTimeline('IŞIK!', [{ target: 'Işık' }], [{ text: 'ışık', start: 10, end: 100 }], 'tr-TR');
  assert.equal(spokenChunk(timeline, 50), 0);
});
