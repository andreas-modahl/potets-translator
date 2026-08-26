import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlight } from './highlight.js';

test('wraps a chunk in bold', () => {
  assert.equal(highlight('iyi bir gün', ['gün']), 'iyi bir **gün**');
});

test('wraps several chunks', () => {
  assert.equal(highlight('iyi bir gün', ['iyi', 'gün']), '**iyi** bir **gün**');
});

test('matches case-insensitively but keeps the original casing', () => {
  assert.equal(highlight('Selam dünya', ['selam']), '**Selam** dünya');
});

test('only wraps the first occurrence of a chunk', () => {
  assert.equal(highlight('gün gün', ['gün']), '**gün** gün');
});

test('prefers the longer chunk when one nests inside another', () => {
  assert.equal(highlight('iyi bir gün', ['iyi bir gün', 'bir']), '**iyi bir gün**');
});

test('leaves mentions, emoji and timestamps untouched', () => {
  const text = '<@123456789> gün <:gun:987654321> <t:1700000000:R>';
  assert.equal(highlight(text, ['gun', 'gün', '123456789']), '<@123456789> **gün** <:gun:987654321> <t:1700000000:R>');
});

test('leaves URLs untouched', () => {
  assert.equal(
    highlight('se https://example.com/gun her', ['gun', 'her']),
    'se https://example.com/gun **her**',
  );
});

test('leaves inline and fenced code untouched', () => {
  assert.equal(highlight('kjør `npm run build` nå', ['npm', 'nå']), 'kjør `npm run build` **nå**');
  assert.equal(highlight('```\nnpm run build\n``` nå', ['npm', 'nå']), '```\nnpm run build\n``` **nå**');
});

test('skips a chunk that is not present', () => {
  assert.equal(highlight('iyi bir gün', ['merhaba']), 'iyi bir gün');
});

test('returns the text unchanged when there is nothing to highlight', () => {
  assert.equal(highlight('iyi bir gün', []), 'iyi bir gün');
  assert.equal(highlight('iyi bir gün', ['   ']), 'iyi bir gün');
});
