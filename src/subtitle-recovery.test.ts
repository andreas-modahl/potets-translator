import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverTranscriptGaps } from './subtitle-recovery.js';

test('recover long internal gaps with absolute timestamps and preserve original words', async () => {
  const first = { text: 'first', start: 0, end: 1000 };
  const last = { text: 'last', start: 26000, end: 27000 };
  const calls: number[][] = [];
  const result = await recoverTranscriptGaps([{ text: 'first last', words: [first, last] }], 27000, async (start, end) => {
    calls.push([start, end]);
    return [{ text: 'recovered', words: [{ text: 'recovered', start: 2000, end: 2500 }] }];
  });
  assert.deepEqual(calls, [[0, 14000], [12000, 26000], [24000, 27000]]);
  assert.deepEqual(result.flatMap(p => p.words), [first,
    { text: 'recovered', start: 2000, end: 2500 },
    { text: 'recovered', start: 14000, end: 14500 }, last]);
});

test('silence does not fabricate subtitles and short gaps are not retried', async () => {
  const phrases = [{ text: 'word', words: [{ text: 'word', start: 1000, end: 2000 }] }];
  assert.equal(await recoverTranscriptGaps(phrases, 3000, async () => { throw Error('unexpected retry'); }), phrases);
  let calls = 0;
  assert.equal(await recoverTranscriptGaps(phrases, 30000, async () => { calls++; return []; }), phrases);
  assert.equal(calls, 3);
});

test('overlapping clip context cannot duplicate existing or recovered words', async () => {
  const phrases = [{ text: 'end', words: [{ text: 'end', start: 25000, end: 26000 }] }];
  const result = await recoverTranscriptGaps(phrases, 26000, async start => [{ text: 'boundary end', words: [
    { text: 'boundary', start: 11800 - start, end: 12200 - start },
    { text: 'end', start: 25000 - start, end: 26000 - start },
  ].filter(w => w.start >= 0) }]);
  assert.deepEqual(result.flatMap(p => p.words).map(w => w.text), ['boundary', 'end']);
});
