import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipRange, sentenceClip } from './speech-clips.js';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const words = [
  { text: 'Go,', start: 100, end: 300 },
  { text: 'go', start: 400, end: 600 },
  { text: 'home!', start: 620, end: 900 },
];

test('selects the requested occurrence of a repeated word', () => {
  assert.deepEqual(clipRange('Go, go home!', 4, 6, words, 'en-GB'), { start: 365, end: 620 });
});

test('clips phrases and includes silence without adjacent speech', () => {
  assert.deepEqual(clipRange('Go, go home!', 4, 11, words, 'en-GB'), { start: 365, end: 950 });
  assert.deepEqual(clipRange('Go, go home!', 7, 11, words, 'en-GB'), { start: 600, end: 950 });
});

test('refuses mismatched transcripts, partial words, and invalid offsets', () => {
  assert.equal(clipRange('Go, go away!', 4, 6, words, 'en-GB'), undefined);
  assert.equal(clipRange('Go, go home!', 8, 11, words, 'en-GB'), undefined);
  assert.equal(clipRange('Go, go home!', -1, 6, words, 'en-GB'), undefined);
  assert.equal(clipRange('Go, go home!', 4, 99, words, 'en-GB'), undefined);
  assert.equal(clipRange('Go, go home!', 4, 4, words, 'en-GB'), undefined);
});

test('matches Turkish casing and punctuation without losing word positions', () => {
  assert.deepEqual(clipRange('IŞIK güzel.', 0, 4, [
    { text: 'ışık', start: 10, end: 400 },
    { text: 'güzel', start: 500, end: 800 },
  ], 'tr-TR'), { start: 0, end: 450 });
});

test('cuts a shorter playable MP3 and reuses the cached clip', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'speech-clip-test-'));
  const file = join(directory, 'sentence.mp3');
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;
  const execute = promisify(execFile);
  try {
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1', '-y', file], { windowsHide: true });
    await writeFile(`${file}.timings-v1.json`, JSON.stringify({ durationMilliseconds: 1000,
      phrases: [{ text: 'Go, go home!', words: words.map(word => ({ text: word.text,
        offsetMilliseconds: word.start, durationMilliseconds: word.end - word.start })) }] }));
    const audio = await readFile(file);
    const clip = await sentenceClip(file, audio, 'Go, go home!', 4, 6, 'en-GB');
    const clipFile = join(directory, 'result.mp3');
    await writeFile(clipFile, clip);
    const decoded = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', clipFile,
      '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'], { encoding: 'buffer', windowsHide: true });
    const duration = decoded.stdout.length / 32000;
    assert.ok(duration > 0.2 && duration < 0.4, `Clip duration: ${duration}`);
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let sample = start; sample < end; sample++) sum += decoded.stdout.readInt16LE(sample * 2) ** 2;
      return Math.sqrt(sum / (end - start));
    };
    const middle = rms(1600, 1760);
    assert.ok(rms(0, 80) < middle * 0.5, 'Clip fades in');
    // MP3 can include encoder delay/padding. Find the audible tail before
    // measuring its final 5 ms, rather than treating padding as a fade.
    let last = decoded.stdout.length / 2;
    while (last > 80 && Math.abs(decoded.stdout.readInt16LE((last - 1) * 2)) < middle * 0.05) last--;
    assert.ok(rms(last - 80, last) < middle * 0.5, 'Clip fades out');
    // A cached cut should not need the recording or timing service again.
    await rm(file);
    await rm(`${file}.timings-v1.json`);
    assert.deepEqual(await sentenceClip(file, audio, 'Go, go home!', 4, 6, 'en-GB'), clip);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
