import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ssmlFor } from './speech.js';

test('a MAI voice is wrapped in the configured style', () => {
  const ssml = ssmlFor('Köpek.', 'tr-TR-Elif:MAI-Voice-2', 'tr-TR');
  assert.match(ssml, /xmlns:mstts="http:\/\/www\.w3\.org\/2001\/mstts"/);
  assert.match(ssml, /<mstts:express-as style="serious"><prosody [^>]*>Köpek\.<\/prosody><\/mstts:express-as>/);
});

test('an older neural voice gets no style', () => {
  const ssml = ssmlFor('Hunden.', 'nb-NO-PernilleNeural', 'nb-NO');
  assert.doesNotMatch(ssml, /express-as/);
  assert.match(ssml, /<voice name="nb-NO-PernilleNeural"><prosody [^>]*>Hunden\.<\/prosody><\/voice>/);
});

test('markup in the text is escaped', () => {
  const ssml = ssmlFor('a < b & "c"', 'tr-TR-Elif:MAI-Voice-2', 'tr-TR');
  assert.match(ssml, /a &lt; b &amp; &quot;c&quot;/);
});
