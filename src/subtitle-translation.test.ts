import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { client } from './claude.js';
import { translateSubtitlePhrase } from './subtitle-translation.js';
const phrase = { text: "prişine'de doğdum.", words: [
  { text: "prişine'de", start: 100, end: 500 }, { text: 'doğdum.', start: 600, end: 1000 },
] };
test('indexed subtitle meanings preserve original spellings and exact word times', async () => {
  const stub = mock.method(client().messages, 'create', async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use',
    input: { chunks: [{ first: 0, last: 0, native: 'i Pristina' }, { first: 1, last: 1, native: 'ble jeg født' }] },
  }] }) as any);
  try {
    const cues = await translateSubtitlePhrase(phrase);
    assert.deepEqual(cues.flatMap(cue => cue.words), phrase.words);
    assert.deepEqual(cues.flatMap(cue => cue.chunks).map(c => [c.start, c.end]), [[100, 500], [600, 1000]]);
  } finally { stub.mock.restore(); }
});
test('indexed subtitle meanings reject missing, repeated, fractional and out-of-range words', async () => {
  for (const chunks of [[], [{ first: 1, last: 1, native: 'x' }], [{ first: 0, last: 2, native: 'x' }],
    [{ first: 0, last: .5, native: 'x' }], [{ first: 0, last: 1, native: '' }],
    [{ first: 0, last: 1, native: 'x' }, { first: 1, last: 1, native: 'x' }]]) {
    const stub = mock.method(client().messages, 'create', async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', input: { chunks } }] }) as any);
    try { await assert.rejects(translateSubtitlePhrase(phrase), /Kunne ikke koble/); assert.equal(stub.mock.callCount(), 2); }
    finally { stub.mock.restore(); }
  }
});
