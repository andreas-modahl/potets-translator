import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { parseCookies, randomToken, serializeCookie } from './session.js';
import { SubtitleStore } from './subtitle-store.js';
import { SubtitleError } from './subtitles.js';

export const subtitleStore = config.lessonDb === 'off' ? undefined : new SubtitleStore(config.lessonDb);
export function subtitleOwner(request: IncomingMessage, response: ServerResponse, userId?: string): string {
  if (process.env.NODE_ENV !== 'production' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return 'local';
  if (userId) return `user:${userId}`;
  let token = parseCookies(request.headers.cookie).get('lb_subtitles');
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    token = randomToken(32);
    response.setHeader('set-cookie', serializeCookie('lb_subtitles', token, {
      maxAge: 365 * 86400, secure: process.env.NODE_ENV === 'production',
    }));
  }
  return 'browser:' + createHash('sha256').update(token).digest('hex');
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function importLocalExamples() {
  for (const stem of ['tavsan-ile-kaplumbaga', 'tembel-tavsan', 'tilki-ile-teke']) {
    const id = `example-${stem}`;
    if (subtitleStore!.get('local', id)) continue;
    try {
      const data = JSON.parse(await readFile(new URL(`../example/${stem}.translation.json`, import.meta.url), 'utf8'));
      subtitleStore!.save('local', { ...data, title: stem.replaceAll('-', ' ') }, id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Could not import subtitle example ${stem}:`, error);
    }
  }
}
export async function handleSubtitleLibrary(request: IncomingMessage, response: ServerResponse, path: string, owner: string) {
  if (!subtitleStore) { send(response, 503, { error: 'Lagring er slått av på serveren (LESSON_DB=off).' }); return; }
  try {
    if (request.method !== 'GET' && request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
      send(response, 403, { error: 'Lagring må skje fra denne siden.' }); return;
    }
    if (path === '/api/subtitle-library' && request.method === 'GET') {
      if (owner === 'local') await importLocalExamples();
      send(response, 200, { items: subtitleStore.list(owner), scope: owner === 'local' ? 'local' : owner.startsWith('user:') ? 'account' : 'browser' }); return;
    }
    const id = path.startsWith('/api/subtitle-library/') ? path.slice('/api/subtitle-library/'.length) : undefined;
    if (id && request.method === 'GET') {
      const saved = subtitleStore.get(owner, id);
      send(response, saved ? 200 : 404, saved ?? { error: 'Fant ikke undertekstene.' }); return;
    }
    if ((!id && request.method === 'POST') || (id && request.method === 'PUT')) {
      if (id && !subtitleStore.get(owner, id)) throw new SubtitleError('Fant ikke undertekstene.', 404);
      const buffers: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2_000_000) throw new SubtitleError('Undertekstfilen er for stor (maks 2 MB).', 413);
        buffers.push(chunk);
      }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(buffers).toString('utf8')); }
      catch { throw new SubtitleError('Ugyldig JSON-fil.', 400); }
      send(response, id ? 200 : 201, subtitleStore.save(owner, data, id)); return;
    }
    send(response, 405, { error: 'Metoden støttes ikke.' });
  } catch (error) {
    if (error instanceof SubtitleError) send(response, error.status, { error: error.message });
    else { console.error('Subtitle library error:', error); send(response, 500, { error: 'Kunne ikke lagre eller hente undertekstene.' }); }
  }
}
