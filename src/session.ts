import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed session cookies, with nothing stored server-side: the cookie carries
 * the user id and an expiry, and an HMAC over both so it cannot be forged or
 * extended. Logging out just clears the cookie.
 */

export const SESSION_COOKIE = 'lb_session';
/** How long a login lasts. */
export const SESSION_DAYS = 90;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** A fresh session token for the user, good for SESSION_DAYS. */
export function makeSession(userId: string, secret: string, now = Date.now()): string {
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${Buffer.from(userId, 'utf8').toString('base64url')}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The user id a token belongs to, or undefined for a forged or expired one. */
export function readSession(token: string | undefined, secret: string, now = Date.now()): string | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [id, expires, signature] = parts as [string, string, string];
  const payload = `${id}.${expires}`;
  const expected = sign(payload, secret);
  if (signature.length !== expected.length) return undefined;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  if (!/^\d+$/u.test(expires) || Number(expires) < now) return undefined;
  return Buffer.from(id, 'base64url').toString('utf8');
}

/** The cookies on a request, by name. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

interface CookieOptions {
  /** Seconds until the cookie is dropped; 0 clears it. */
  maxAge: number;
  secure: boolean;
  /** Lax lets the cookie ride along when Google sends the browser back to us. */
  sameSite?: 'Lax' | 'Strict';
}

/** A Set-Cookie header value: HttpOnly always, Secure when served over TLS. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${options.sameSite ?? 'Lax'}`,
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** A random string for OAuth state and for a session secret nobody configured. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
