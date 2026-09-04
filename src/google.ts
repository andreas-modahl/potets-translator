import { config } from './config.js';
import type { User } from './users.js';

/**
 * Sign-in with Google, done the old-fashioned way: the browser is sent to
 * Google, comes back with a code, and the server trades the code for an ID
 * token over its own TLS connection to Google. No Google script runs on the
 * page, and the ID token needs no signature check, because it came straight
 * from Google's token endpoint rather than from the browser.
 */

export const googleConfigured = Boolean(config.googleClientId && config.googleClientSecret);

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Where to send the browser to log in. */
export function loginUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export class GoogleLoginFailed extends Error {}

/** Trades the code Google sent back for who the user is. */
export async function exchangeCode(code: string, redirectUri: string): Promise<User> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    throw new GoogleLoginFailed(`Google's token endpoint answered ${response.status}.`);
  }
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new GoogleLoginFailed('Google sent no ID token.');
  return userFromIdToken(body.id_token);
}

/** The user inside an ID token that came straight from Google. */
export function userFromIdToken(idToken: string): User {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleLoginFailed('The ID token is not a JWT.');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new GoogleLoginFailed('The ID token could not be read.');
  }
  const { sub, email, name, picture, aud } = claims;
  if (aud !== config.googleClientId) throw new GoogleLoginFailed('The ID token is for another app.');
  if (typeof sub !== 'string' || !sub) throw new GoogleLoginFailed('The ID token names no user.');
  return {
    id: `google:${sub}`,
    email: typeof email === 'string' ? email : '',
    name: typeof name === 'string' && name ? name : typeof email === 'string' ? email : 'Google user',
    picture: typeof picture === 'string' ? picture : '',
  };
}
