import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lesson, LessonRequest } from './lesson.js';
import { LessonPool, stem, topicKey } from './pool.js';

function sample(target: string, chunks = 1): Lesson {
  return {
    learning: 'tr',
    target,
    native: 'Hunden min er søt.',
    chunks: Array.from({ length: chunks }, (_, i) => ({ target: `p${i}`, native: `n${i}`, pos: 'noun' })),
  };
}

const ask: LessonRequest = { learning: 'tr', level: 'nybegynner', topic: 'hunder' };

describe('topicKey', () => {
  it('files spellings of the same topic together', () => {
    assert.equal(topicKey('Hunder'), 'hunder');
    assert.equal(topicKey('  hunder. '), 'hunder');
    assert.equal(topicKey('på   kafé'), 'på kafé');
    assert.equal(topicKey('KÖPEKLER'), 'köpekler');
  });

  it('gives the topicless request a shelf of its own', () => {
    assert.equal(topicKey(undefined), '');
    assert.equal(topicKey('   '), '');
  });
});

describe('stem', () => {
  it('drops the last letter of longer words and keeps short ones whole', () => {
    assert.equal(stem('köpek'), 'kope');
    assert.equal(stem('Kedi'), 'kedi');
    assert.equal(stem('hund'), 'hund');
    assert.equal(stem('Işık'), 'isik');
    assert.equal(stem('Köpeğim'), 'kopegi');
  });
});

describe('LessonPool', () => {
  it('keeps 120 turns fresh even after both the old exclusion window and visible log would expire', () => {
    const pool = new LessonPool(':memory:');
    const avoid: string[] = [];
    for (let i = 0; i < 31; i++) pool.store(ask, sample(`Sentence ${i}.`));
    let generated = 0;
    for (let turn = 0; turn < 120; turn++) {
      const request = { ...ask, avoid };
      let next = pool.pick(request);
      if (!next) {
        next = sample(`Fresh ${generated++}.`);
        pool.store(request, next);
      }
      assert(!avoid.includes(next.target));
      avoid.push(next.target);
    }
    assert.equal(new Set(avoid).size, 120);
    assert.equal(generated, 89, 'exhaustion requests fresh material instead of recycling');
    assert.equal(pool.available({ ...ask, avoid }), 0);
    pool.close();
  });

  it('excludes punctuation/case variants and counts unseen supply on a large shelf', () => {
    const pool = new LessonPool(':memory:');
    pool.store(ask, sample('Kedi uyuyor.'));
    assert.equal(pool.pick({ ...ask, avoid: ['  KEDİ   UYUYOR! '] }), undefined);
    for (let i = 0; i < 40; i++) pool.store(ask, sample(`Sentence ${i}`));
    assert.equal(pool.available({ ...ask, avoid: pool.targets(ask).slice(0, -2) }), 2);
    pool.close();
  });

  it('prefers a different structure and verb when alternatives are available', () => {
    const pool = new LessonPool(':memory:');
    const make = (target: string, verb: string, question = false): Lesson => ({
      learning: 'tr', target, native: target,
      chunks: [{ target: verb, native: verb, pos: 'verb' },
        { target: 'x', native: 'x', pos: question ? 'particle' : 'noun' }],
    });
    pool.store(ask, make('Old', 'sev'));
    pool.store(ask, make('Same pattern', 'sev'));
    pool.store(ask, make('New question', 'gel', true));
    assert.equal(pool.pick({ ...ask, avoid: ['Old'] })?.target, 'New question');
    pool.close();
  });

  it('does not match a short review word inside an unrelated word', () => {
    const pool = new LessonPool(':memory:');
    pool.store(ask, sample('Seviyorum.'));
    assert.equal(pool.pick({ ...ask, review: ['ev'] }), undefined);
    pool.close();
  });
  it('files extras by kind, direction and key, and lets a later one replace an earlier', () => {
    const pool = new LessonPool(':memory:');
    assert.equal(pool.extra('forms', 'tr', 'sevmek'), undefined);
    pool.keep('forms', 'tr', 'sevmek', '{"a":1}');
    assert.equal(pool.extra('forms', 'tr', 'sevmek'), '{"a":1}');
    assert.equal(pool.extra('forms', 'nb', 'sevmek'), undefined);
    assert.equal(pool.extra('other', 'tr', 'sevmek'), undefined);
    pool.keep('forms', 'tr', 'sevmek', '{"a":2}');
    assert.equal(pool.extra('forms', 'tr', 'sevmek'), '{"a":2}');
    pool.close();
  });

  it('hands back what was stored, and nothing the learner has seen', () => {
    const pool = new LessonPool(':memory:');
    assert.equal(pool.pick(ask), undefined);

    assert.equal(pool.store(ask, sample('Köpeğim sevimli.')), true);
    assert.equal(pool.store(ask, sample('Köpeğim sevimli.')), false, 'a repeat is ignored');
    assert.equal(pool.store(ask, sample('Köpek havlıyor.')), true);
    assert.equal(pool.count(ask), 2);

    const picked = pool.pick({ ...ask, avoid: ['Köpeğim sevimli.'] });
    assert.equal(picked?.target, 'Köpek havlıyor.');

    assert.equal(pool.pick({ ...ask, avoid: ['Köpeğim sevimli.', 'Köpek havlıyor. '] }), undefined);
    pool.close();
  });

  it('keeps shelves apart by direction, level and topic', () => {
    const pool = new LessonPool(':memory:');
    pool.store(ask, sample('Köpeğim sevimli.'));
    assert.equal(pool.pick({ ...ask, level: 'avansert' }), undefined);
    assert.equal(pool.pick({ ...ask, topic: 'katter' }), undefined);
    assert.equal(pool.pick({ ...ask, learning: 'nb' }), undefined);
    assert.equal(pool.pick({ ...ask, topic: 'HUNDER ' })?.target, 'Köpeğim sevimli.');
    assert.deepEqual(pool.targets(ask), ['Köpeğim sevimli.']);
    pool.close();
  });

  it('brings back a word the learner should meet again, or nothing', () => {
    const pool = new LessonPool(':memory:');
    pool.store(ask, sample('Köpeğim sevimli.'));
    pool.store(ask, sample('Kedi uyuyor.'));
    // "köpek" softens to "köpeğ" when a suffix follows; the stem still matches.
    assert.equal(pool.pick({ ...ask, review: ['köpek'] })?.target, 'Köpeğim sevimli.');
    assert.equal(pool.pick({ ...ask, review: ['KEDİ'] })?.target, 'Kedi uyuyor.');
    assert.equal(pool.pick({ ...ask, review: ['araba'] }), undefined, 'nothing on the shelf has it');
    pool.close();
  });

  it('drops a lesson shelved before word classes were asked for', () => {
    const pool = new LessonPool(':memory:');
    const stale = sample('Kedi uyuyor.');
    stale.chunks = [{ target: 'Kedi', native: 'katten' }];
    pool.store(ask, stale);
    assert.equal(pool.count(ask), 1);
    assert.equal(pool.pick(ask), undefined, 'not handed out');
    assert.equal(pool.count(ask), 0, 'and gone from the shelf');
    pool.close();
  });

  it('refuses a lesson without its breakdown', () => {
    const pool = new LessonPool(':memory:');
    assert.equal(pool.store(ask, sample('Köpeğim sevimli.', 0)), false);
    assert.equal(pool.count(ask), 0);
    pool.close();
  });
});
