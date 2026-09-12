import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { parseCookies, randomToken, serializeCookie } from './session.js';
import { SubtitleStore } from './subtitle-store.js';
import { SubtitleError } from './subtitles.js';

export const subtitleStore = config.lessonDb === 'off' ? undefined : new SubtitleStore(config.lessonDb);
const EXAMPLE_STEMS = ['tavsan-ile-kaplumbaga', 'tembel-tavsan', 'tilki-ile-teke'];
/** Only known local examples can be served; database filenames are never paths. */
async function exampleMedia(owner: string, source: string): Promise<URL | undefined> {
  if (owner !== 'local' || !EXAMPLE_STEMS.some(stem => source === `${stem}.mp3`)) return;
  const file = new URL(`../example/${source}`, import.meta.url);
  try { if ((await stat(file)).isFile()) return file; } catch {}
}
export function audioRange(header: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return;
  return { start, end };
}
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
  for (const stem of EXAMPLE_STEMS) {
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
    if (id?.endsWith('/audio') && (request.method === 'GET' || request.method === 'HEAD')) {
      const saved = subtitleStore.get(owner, id.slice(0, -'/audio'.length));
      const file = saved && await exampleMedia(owner, saved.source);
      if (!file) { send(response, 404, { error: 'Velg originalfilen for å spille av undertekstene.' }); return; }
      const audio = await readFile(file);
      const range = audioRange(request.headers.range, audio.length);
      if (!range) {
        response.writeHead(416, { 'content-range': `bytes */${audio.length}` }); response.end(); return;
      }
      response.writeHead(request.headers.range ? 206 : 200, {
        'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
        'content-length': range.end - range.start + 1,
        ...(request.headers.range ? { 'content-range': `bytes ${range.start}-${range.end}/${audio.length}` } : {}),
      });
      response.end(request.method === 'HEAD' ? undefined : audio.subarray(range.start, range.end + 1)); return;
    }
    if (id && request.method === 'GET') {
      const saved = subtitleStore.get(owner, id);
      const audioUrl = saved && await exampleMedia(owner, saved.source) ? `/api/subtitle-library/${encodeURIComponent(id)}/audio` : undefined;
      send(response, saved ? 200 : 404, saved ? { ...saved, audioUrl } : { error: 'Fant ikke undertekstene.' }); return;
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
