import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignmentInput } from './subtitle-alignment.js';

test('alignment requests require bounded existing Norwegian and Turkish meaning groups', () => {
  const input = { natural: 'Denne haren.', chunks: [{ target: 'Bu', native: 'denne' }, { target: 'tavşan', native: 'haren' }] };
  assert.deepEqual(alignmentInput(input), input);
  for (const invalid of [null, {}, { ...input, natural: '' }, { ...input, natural: 'x'.repeat(10001) },
    { ...input, chunks: [] }, { ...input, chunks: Array(201).fill(input.chunks[0]) },
    { ...input, chunks: [{ target: 12, native: 'haren' }] }, { ...input, chunks: [null] }]) {
    assert.equal(alignmentInput(invalid), undefined);
  }
});
