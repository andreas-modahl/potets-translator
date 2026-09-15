import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioClip, subtitleChunks } from './subtitle-chunks.js';

test('PCM clips have a valid WAV header and exact sample boundaries', () => {
  const pcm = Buffer.alloc(32000, 7);
  const wav = audioClip(pcm, 100, 300);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(40), 6400);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.deepEqual(wav.subarray(44), pcm.subarray(3200, 9600));
});

test('chunks preserve absolute times and yield early without duplicate boundary words', async () => {
  let calls = 0;
  const chunks = subtitleChunks(Buffer.alloc(121000 * 32), async wav => {
    calls++;
    assert.ok(wav.length <= 62000 * 32 + 44);
    const words = calls === 1 ? [{ text: 'before', start: 59500, end: 59900 }, { text: 'boundary', start: 59900, end: 60300 }]
      : calls === 2 ? [{ text: 'boundary', start: 900, end: 1300 }, { text: 'after', start: 2000, end: 2300 }]
      : [{ text: 'end', start: 1500, end: 1900 }];
    return [{ text: words.map(w => w.text).join(' '), words }];
  });
  const first = await chunks.next();
  assert.equal(calls, 1);
  assert.equal(first.value!.end, 60000);
  const words = first.value!.phrases.flatMap(p => p.words);
  for await (const chunk of chunks) words.push(...chunk.phrases.flatMap(p => p.words));
  assert.deepEqual(words.map(w => [w.text, w.start]), [['before', 59500], ['boundary', 59900], ['after', 61000], ['end', 120500]]);
  assert.equal(calls, 3);
});

test('2 hour limit is accepted and longer audio rejected before transcription', async () => {
  let calls = 0;
  const pcm = Buffer.alloc(7200001 * 32);
  for await (const _ of subtitleChunks(pcm.subarray(0, 7200000 * 32), async () => { calls++; return []; })) {}
  assert.equal(calls, 120);
  await assert.rejects(async () => { for await (const _ of subtitleChunks(pcm, async () => { throw Error('must not transcribe'); })) {} }, /2 timer/);
});
