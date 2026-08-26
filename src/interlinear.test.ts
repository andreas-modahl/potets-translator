import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interlinear } from './interlinear.js';

test('pads each column to the wider of the two languages', () => {
  const out = interlinear([
    { source: 'det er fint', target: 'hava güzel' },
    { source: 'og', target: 've' },
  ]);

  assert.equal(out, ['hava güzel   ve', 'det er fint  og'].join('\n'));
});

test('puts the translation above the original', () => {
  const [first, second] = interlinear([{ source: 'hei', target: 'selam' }]).split('\n');
  assert.equal(first, 'selam');
  assert.equal(second, 'hei');
});

test('lines up when the translation is the longer side', () => {
  const out = interlinear([
    { source: 'takk', target: 'teşekkürler' },
    { source: 'ja', target: 'evet' },
  ]);
  const [target, source] = out.split('\n');
  assert.equal(target, 'teşekkürler  evet');
  assert.equal(source, 'takk         ja');
  // The columns must start at the same offset on both lines.
  assert.equal(target.indexOf('evet'), source.indexOf('ja'));
});

test('breaks into stanzas rather than letting a row wrap', () => {
  const long = Array.from({ length: 8 }, (_, i) => ({
    source: `norsk${i}`,
    target: `tyrkisk${i}`,
  }));
  const out = interlinear(long);
  const stanzas = out.split('\n\n');

  assert.ok(stanzas.length > 1, 'expected more than one stanza');
  for (const stanza of stanzas) {
    const [target, source] = stanza.split('\n');
    assert.ok(target !== undefined && source !== undefined, 'expected two lines');
    assert.ok(target.length < 45, `row too wide: ${target.length}`);
    assert.ok(source.length < 45, `row too wide: ${source.length}`);
  }
});

test('gives an unbreakably long pair a row of its own', () => {
  const out = interlinear([
    { source: 'ja', target: 'evet' },
    {
      source: 'en setning som er altfor lang til å få plass her igjen',
      target: 'çok uzun bir cümle',
    },
  ]);
  const stanzas = out.split('\n\n');

  assert.equal(stanzas.length, 2);
  assert.equal(stanzas[0], 'evet\nja');
  assert.equal(
    stanzas[1],
    'çok uzun bir cümle\nen setning som er altfor lang til å få plass her igjen',
  );
});

test('trims trailing padding off the end of a row', () => {
  const out = interlinear([{ source: 'takk', target: 'teşekkürler' }]);
  assert.equal(out, 'teşekkürler\ntakk');
});

test('returns nothing when there is nothing to lay out', () => {
  assert.equal(interlinear([]), '');
  assert.equal(interlinear([{ source: '  ', target: '  ' }]), '');
});
