import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SavedSubtitles } from './subtitle-store.js';

type LibraryRecord = SavedSubtitles & { canEdit: boolean; owner?: string; audioUrl?: string };

test('visitors can open saved translations and cached YouTube media, but edit their own copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shared-subtitles-'));
  process.env.LESSON_DB = ':memory:';
  process.env.YOUTUBE_MEDIA_DIR = directory;
  const { handleSubtitleLibrary, subtitleStore, subtitleWriters } = await import('./subtitle-library.js');
  const { handleSubtitles } = await import('./subtitle-jobs.js');
  const store = subtitleStore!;
  const source = 'https://www.youtube.com/watch?v=rEJb7j61-es';
  const value = { title: 'Shared video', source, cues: [{ start: 100, end: 900, text: 'I morgen', turkish: 'Yarın',
    words: [{ start: 100, end: 900, text: 'Yarın' }], chunks: [{ start: 100, end: 900, text: 'I morgen' }] }] };
  const saved = store.save('alice', value);
  const server = createServer((request, response) => {
    const handler = request.url?.startsWith('/api/subtitles/') ? handleSubtitles : handleSubtitleLibrary;
    void handler(request, response, request.url!, String(request.headers['x-test-owner'] || 'bob'));
  });
  try {
    const filename = createHash('sha256').update('alice' + '\0' + source).digest('hex') + '.mp4';
    await writeFile(join(directory, filename), 'test video');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}/api/subtitle-library`;
    const listing = await (await fetch(base)).json() as { scope: string; items: SavedSubtitles[] };
    assert.equal(listing.scope, 'shared');
    assert.ok(listing.items.some((item: { id: string }) => item.id === saved.id));
    const opened = await (await fetch(`${base}/${saved.id}`)).json() as LibraryRecord;
    assert.equal(opened.canEdit, false);
    assert.equal(opened.owner, undefined);
    assert.equal(opened.source, source);
    assert.deepEqual(opened.cues, value.cues);
    assert.ok(opened.audioUrl);
    const audio = await fetch(`${base}/${saved.id}/audio`, { headers: { range: 'bytes=0-3' } });
    assert.equal(audio.status, 206);
    assert.equal(await audio.text(), 'test');
    const edit = await fetch(`${base}/${saved.id}`, { method: 'PUT', body: JSON.stringify({ ...value, title: 'Overwrite' }) });
    assert.equal(edit.status, 404);
    assert.equal(store.get('alice', saved.id)?.title, value.title);
    const copied = await fetch(base, { method: 'POST', body: JSON.stringify({ ...value, title: 'My copy' }) });
    assert.equal(copied.status, 201);
    const copy = await copied.json() as SavedSubtitles;
    assert.notEqual(copy.id, saved.id);
    const own = await (await fetch(`${base}/${copy.id}`)).json() as LibraryRecord;
    assert.equal(own.canEdit, true);
    assert.equal(await (await fetch(`${base}/${copy.id}/audio`)).text(), 'test video');
    const update = await fetch(`${base}/${copy.id}`, { method: 'PUT', body: JSON.stringify({ ...value, title: 'Edited copy' }) });
    assert.equal(update.status, 200);
    assert.equal(store.getShared('alice', copy.id)?.title, 'Edited copy');
    const sections = [{ start: 0, end: 60000, state: 'done' as const, attempts: 1 }];
    store.saveProgress('alice', saved.id, value, sections);
    const progress = await (await fetch(`${base}/${saved.id}`)).json() as { sections: unknown };
    assert.deepEqual(progress.sections, sections);
    const ensure = await fetch(`http://127.0.0.1:${address.port}/api/subtitles/ensure`, {
      method: 'POST', body: JSON.stringify({ savedId: saved.id }),
    });
    assert.equal(ensure.status, 200);
    assert.deepEqual(await ensure.json(), { complete: true, sections });
    subtitleWriters.add(saved.id);
    const locked = await fetch(`${base}/${saved.id}`, { method: 'PUT', headers: { 'x-test-owner': 'alice' }, body: JSON.stringify(value) });
    assert.equal(locked.status, 409);
    subtitleWriters.delete(saved.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
