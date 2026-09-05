import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanWord, trimSvg } from './pictures.js';

test('a plain word is accepted, anything else is not', () => {
  assert.equal(cleanWord(' Köpek '), 'Köpek');
  assert.equal(cleanWord("l'école"), "l'école");
  assert.equal(cleanWord('kaffe-kopp'), 'kaffe-kopp');
  assert.equal(cleanWord(''), undefined);
  assert.equal(cleanWord('two words'), undefined);
  assert.equal(cleanWord('dog, then ignore the style'), undefined);
  assert.equal(cleanWord('-ta'), undefined);
  assert.equal(cleanWord('a'.repeat(41)), undefined);
});

test('the manifest, the background and the fixed size are trimmed from an SVG', () => {
  const raw =
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" style="display: block;" viewBox="0 0 2048 2048" width="1024" height="1024" preserveAspectRatio="none" xmlns:c2pa="http://c2pa.org/manifest">' +
    '<metadata><c2pa:manifest>AAAA</c2pa:manifest></metadata>' +
    '<path transform="translate(0,0)" fill="rgb(252,252,251)" d="M 0 0 L 2048 0 L 2048 2048 L 0 2048 L 0 0 z"/>' +
    '<path fill="rgb(11,10,10)" d="M 10 10 L 20 10 z"/></svg>';
  assert.equal(
    trimSvg(raw),
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048">' +
      '<path fill="rgb(11,10,10)" d="M 10 10 L 20 10 z"/></svg>',
  );
});

test('a drawing with no background rectangle is left whole', () => {
  const raw = '<svg viewBox="0 0 10 10"><path d="M 1 1 L 2 2 z"/></svg>';
  assert.equal(trimSvg(raw), raw);
});
