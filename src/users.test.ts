import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UserStore } from './users.js';

const alice = { id: 'google:1', email: 'a@example.com', name: 'Alice', picture: 'https://p/1' };

describe('UserStore', () => {
  it('records logins and updates what Google reports', () => {
    const store = new UserStore(':memory:');
    store.upsert(alice);
    store.upsert({ ...alice, name: 'Alice B' });
    assert.deepEqual(store.get('google:1'), { ...alice, name: 'Alice B' });
    assert.equal(store.get('google:2'), undefined);
    store.close();
  });

  it('keeps one blob per direction', () => {
    const store = new UserStore(':memory:');
    store.upsert(alice);
    assert.deepEqual(store.state('google:1'), {});
    store.setState('google:1', 'tr', { ordbank: [{ target: 'köpek' }] });
    store.setState('google:1', 'nb', { ordbank: [] });
    store.setState('google:1', 'tr', { ordbank: [{ target: 'köpek' }, { target: 'kedi' }] });
    assert.deepEqual(store.state('google:1'), {
      tr: { ordbank: [{ target: 'köpek' }, { target: 'kedi' }] },
      nb: { ordbank: [] },
    });
    store.close();
  });

  it('refuses a blob that is too large', () => {
    const store = new UserStore(':memory:');
    store.upsert(alice);
    assert.throws(() => store.setState('google:1', 'tr', { big: 'x'.repeat(1_000_001) }), RangeError);
    store.close();
  });
});
