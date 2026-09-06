import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildForms } from './forms.js';

const ask = { learning: 'tr' as const, word: 'seviyorum', pos: 'verb' };

test('forms are kept with their pieces when the pieces spell them', () => {
  const built = buildForms(
    {
      base: 'sevmek',
      meaning: 'å elske',
      groups: [
        {
          name: 'presens (-iyor)',
          hint: '-iyor',
          forms: [
            { label: 'ben (jeg)', word: 'seviyorum', pieces: ['sev', 'iyor', 'um'] },
            { label: 'biz (vi)', word: 'seviyoruz', pieces: ['sev', 'iyor', 'uz'] },
          ],
        },
        {
          name: 'preteritum (-di)',
          forms: [{ label: 'ben (jeg)', word: 'sevdim', pieces: ['sev', 'di', 'm'] }],
        },
      ],
    },
    ask,
  );
  assert.equal(built.base, 'sevmek');
  assert.equal(built.meaning, 'å elske');
  assert.equal(built.groups.length, 2);
  assert.deepEqual(built.groups[0]?.forms[1], { label: 'biz (vi)', word: 'seviyoruz', pieces: ['sev', 'iyor', 'uz'] });
  assert.equal(built.groups[0]?.hint, '-iyor');
  assert.equal(built.groups[1]?.hint, undefined);
});

test('pieces that do not spell the form give way to the form in one piece', () => {
  const built = buildForms(
    {
      base: 'gitmek',
      meaning: 'å gå',
      groups: [
        {
          name: 'presens',
          forms: [
            { label: 'ben', word: 'gidiyorum', pieces: ['git', 'iyor', 'um'] },
            { label: 'sen', word: 'gidiyorsun', pieces: ['gitmek', 'iyor', 'sun'] },
            { label: 'o', word: 'gidiyor', pieces: [] },
          ],
        },
      ],
    },
    ask,
  );
  const [ben, sen, o] = built.groups[0]?.forms ?? [];
  assert.deepEqual(ben?.pieces, ['git', 'iyor', 'um'], 'the softened root still counts');
  assert.deepEqual(sen?.pieces, ['gidiyorsun']);
  assert.deepEqual(o?.pieces, ['gidiyor']);
});

test('empty groups, nameless groups and half-filled forms are dropped; nothing at all is still a table', () => {
  const built = buildForms(
    {
      groups: [
        { name: 'tom', forms: [] },
        { forms: [{ label: 'x', word: 'y', pieces: ['y'] }] },
        { name: 'halv', forms: [{ label: 'ben', pieces: [] }, { word: 'sevdim' }] },
      ],
    },
    ask,
  );
  assert.deepEqual(built.groups, []);
  assert.equal(built.base, 'seviyorum');
  assert.equal(built.meaning, '');
  assert.deepEqual(buildForms(null, ask).groups, []);
});
