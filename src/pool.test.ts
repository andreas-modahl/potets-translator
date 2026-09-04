import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lesson, LessonRequest } from './lesson.js';
import { LessonPool, stem, topicKey } from './pool.js';

function sample(target: string, chunks = 1): Lesson {
  return {
    learning: 'tr',
    target,
    native: 'Hunden min er søt.',
    chunks: Array.from({ length: chunks }, (_, i) => ({ target: `p${i}`, native: `n${i}` })),
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

  it('refuses a lesson without its breakdown', () => {
    const pool = new LessonPool(':memory:');
    assert.equal(pool.store(ask, sample('Köpeğim sevimli.', 0)), false);
    assert.equal(pool.count(ask), 0);
    pool.close();
  });
});
