import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeSession, parseCookies, readSession, serializeCookie } from './session.js';

const SECRET = 'a secret for the tests';

describe('sessions', () => {
  it('round-trips a user id', () => {
    const token = makeSession('google:123', SECRET);
    assert.equal(readSession(token, SECRET), 'google:123');
  });

  it('rejects a token signed with another secret, or tampered with', () => {
    const token = makeSession('google:123', SECRET);
    assert.equal(readSession(token, 'another'), undefined);
    const [id, expires, signature] = token.split('.');
    const forged = `${Buffer.from('google:999').toString('base64url')}.${expires}.${signature}`;
    assert.equal(readSession(forged, SECRET), undefined);
    assert.equal(readSession(`${id}.${Number(expires) + 1000}.${signature}`, SECRET), undefined);
    assert.equal(readSession('garbage', SECRET), undefined);
    assert.equal(readSession(undefined, SECRET), undefined);
  });

  it('expires', () => {
    const issued = Date.parse('2026-01-01T00:00:00Z');
    const token = makeSession('google:123', SECRET, issued);
    assert.equal(readSession(token, SECRET, issued + 24 * 3600 * 1000), 'google:123');
    assert.equal(readSession(token, SECRET, issued + 91 * 24 * 3600 * 1000), undefined);
  });
});

describe('cookies', () => {
  it('parses a cookie header', () => {
    const cookies = parseCookies('a=1; lb_session=x.y.z; b=%20spaced');
    assert.equal(cookies.get('lb_session'), 'x.y.z');
    assert.equal(cookies.get('b'), ' spaced');
    assert.equal(parseCookies(undefined).size, 0);
  });

  it('serializes with the safe flags', () => {
    assert.equal(
      serializeCookie('lb_session', 'tok', { maxAge: 60, secure: true }),
      'lb_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure',
    );
    assert.equal(
      serializeCookie('lb_session', '', { maxAge: 0, secure: false }),
      'lb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });
});
