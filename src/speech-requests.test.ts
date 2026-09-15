import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechRequests, speechRetryDelay } from './speech-requests.js';

test('Speech cooldown honors Retry-After seconds and HTTP dates, otherwise backs off', () => {
  assert.equal(speechRetryDelay('90', 0, 0), 90000);
  assert.equal(speechRetryDelay('Thu, 01 Jan 1970 00:02:00 GMT', 0, 0), 120000);
  assert.equal(speechRetryDelay(null, 0), 30000);
  assert.equal(speechRetryDelay('invalid', 2), 120000);
});
test('concurrent section requests share cooldown and retry only the throttled request', async () => {
  let now = 0;
  const waits: number[] = [], calls: string[] = [];
  const queue = new SpeechRequests(() => now, async ms => { waits.push(ms); now += ms; });
  let first = true;
  const signal = new AbortController().signal;
  await Promise.all([
    queue.run(async () => { calls.push('a'); if (first) { first = false; return new Response('', { status: 429, headers: { 'retry-after': '60' } }); } return new Response('{}'); }, signal),
    queue.run(async () => { calls.push('b'); return new Response('{}'); }, signal),
  ]);
  assert.deepEqual(calls, ['a', 'a', 'b']);
  assert.deepEqual(waits, [60000, 1000]);
});
test('persistent throttling opens a shared circuit instead of hammering queued sections', async () => {
  let now = 0, calls = 0;
  const queue = new SpeechRequests(() => now, async ms => { now += ms; });
  const request = async () => { calls++; return new Response('', { status: 429 }); };
  await assert.rejects(queue.run(request, new AbortController().signal), /429/);
  assert.equal(calls, 5);
  await assert.rejects(queue.run(request, new AbortController().signal), /429/);
  assert.equal(calls, 5);
});
test('cancelling a cooldown prevents the retry', async () => {
  const controller = new AbortController();
  const queue = new SpeechRequests(() => 0, async () => { controller.abort(); });
  let calls = 0;
  await assert.rejects(queue.run(async () => { calls++; return new Response('', { status: 429 }); }, controller.signal));
  assert.equal(calls, 1);
});
